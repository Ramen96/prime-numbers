import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPTY_PERSONAL_DATA,
  PERSONAL_DATA_STORAGE_KEY,
  parsePersonalData,
  readStorageNoticeSeen,
  saveStorageNoticeSeen,
  readStoredPersonalData,
  savePersonalData,
  serializePersonalData,
  withFavoriteAdded,
  withFavoriteRemoved,
  withRecordsCleared,
  withRecordsMerged,
  type KeyValueStorage,
} from "./personalData.ts";

class InMemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

class ThrowingStorage implements KeyValueStorage {
  readonly errorToThrow: unknown;
  constructor(errorToThrow: unknown) {
    this.errorToThrow = errorToThrow;
  }
  getItem(): string | null {
    throw this.errorToThrow;
  }
  setItem(): void {
    throw this.errorToThrow;
  }
}

const FAR_ABOVE_2_TO_THE_64 = 2n ** 200n + 235n; // 61 digits
const JUST_ABOVE_2_TO_THE_64 = 2n ** 64n + 13n;

describe("storing personal data", () => {
  it("round-trips values far above 2^64 exactly", () => {
    const storage = new InMemoryStorage();
    let data = withFavoriteAdded(EMPTY_PERSONAL_DATA, FAR_ABOVE_2_TO_THE_64);
    data = withFavoriteAdded(data, 7n);
    data = withRecordsMerged(data, {
      furthestScroll: JUST_ABOVE_2_TO_THE_64.toString(),
      biggestPrimeVisited: FAR_ABOVE_2_TO_THE_64.toString(),
    });
    assert.equal(savePersonalData(storage, data), "saved");

    const restored = readStoredPersonalData(storage)!;
    assert.deepEqual(restored, data);
    assert.equal(BigInt(restored.favorites[1]), FAR_ABOVE_2_TO_THE_64);
    assert.equal(BigInt(restored.records.biggestPrimeVisited!), FAR_ABOVE_2_TO_THE_64);
    // Stored as decimal strings, never numbers.
    assert.match(storage.items.get(PERSONAL_DATA_STORAGE_KEY)!, /"1606938044258990275541962092341162602522202993782792835301611"/);
  });

  it("sorts favorites numerically, not as text, and drops duplicates", () => {
    let data = EMPTY_PERSONAL_DATA;
    for (const prime of [97n, 1_000_003n, 7n, FAR_ABOVE_2_TO_THE_64, 97n, 11n]) {
      data = withFavoriteAdded(data, prime);
    }
    assert.deepEqual(data.favorites, ["7", "11", "97", "1000003", FAR_ABOVE_2_TO_THE_64.toString()]);
    assert.deepEqual(withFavoriteRemoved(data, 97n).favorites, ["7", "11", "1000003", FAR_ABOVE_2_TO_THE_64.toString()]);
  });

  it("keeps the larger record when merging, comparing as BigInt", () => {
    const data = withRecordsMerged(
      { ...EMPTY_PERSONAL_DATA, records: { furthestScroll: "999", biggestPrimeVisited: "99999999999999999999" } },
      { furthestScroll: "1000", biggestPrimeVisited: "100000000000000000" },
    );
    assert.deepEqual(data.records, { furthestScroll: "1000", biggestPrimeVisited: "99999999999999999999" });
    assert.deepEqual(withRecordsCleared(data).records, EMPTY_PERSONAL_DATA.records);
  });
});

describe("ignoring bad stored data", () => {
  for (const [description, stored] of [
    ["not JSON", "{oops"],
    ["JSON but not an object", "42"],
    ["null", "null"],
    ["an older version", JSON.stringify({ version: 0, favorites: ["7"], records: {} })],
    ["a newer version", JSON.stringify({ version: 2, favorites: ["7"], records: {} })],
    ["no version", JSON.stringify({ favorites: ["7"] })],
  ] as const) {
    it(`treats ${description} as empty`, () => {
      assert.deepEqual(parsePersonalData(stored), EMPTY_PERSONAL_DATA);
    });
  }

  it("drops individual entries that aren't whole decimal numbers", () => {
    const stored = JSON.stringify({
      version: 1,
      favorites: ["7", 11, "-3", "1e9", "0x1f", "007", "13", null, "2.5", "17"],
      records: { furthestScroll: 5000, biggestPrimeVisited: "abc" },
    });
    assert.deepEqual(parsePersonalData(stored), {
      favorites: ["7", "13", "17"],
      records: { furthestScroll: null, biggestPrimeVisited: null },
    });
  });

  it("replaces bad data on the next save", () => {
    const storage = new InMemoryStorage();
    storage.setItem(PERSONAL_DATA_STORAGE_KEY, "{oops");
    const data = withFavoriteAdded(readStoredPersonalData(storage)!, 7n);
    savePersonalData(storage, data);
    assert.equal(storage.items.get(PERSONAL_DATA_STORAGE_KEY), serializePersonalData(data));
  });
});

describe("when storage misbehaves", () => {
  it("reading from storage that throws gives null instead of crashing", () => {
    assert.equal(readStoredPersonalData(new ThrowingStorage(new DOMException("denied", "SecurityError"))), null);
    assert.equal(readStoredPersonalData(null), null);
  });

  it("saving to storage that throws reports it as unavailable", () => {
    const blocked = new ThrowingStorage(new DOMException("denied", "SecurityError"));
    assert.equal(savePersonalData(blocked, EMPTY_PERSONAL_DATA), "storage-unavailable");
    assert.equal(savePersonalData(null, EMPTY_PERSONAL_DATA), "storage-unavailable");
    assert.equal(savePersonalData(new ThrowingStorage(new Error("weird")), EMPTY_PERSONAL_DATA), "storage-unavailable");
  });

  it("saving to full storage reports it as full", () => {
    const full = new ThrowingStorage(new DOMException("full", "QuotaExceededError"));
    assert.equal(savePersonalData(full, EMPTY_PERSONAL_DATA), "storage-full");
    const fullInFirefox = new ThrowingStorage(new DOMException("full", "NS_ERROR_DOM_QUOTA_REACHED"));
    assert.equal(savePersonalData(fullInFirefox, EMPTY_PERSONAL_DATA), "storage-full");
  });
});

describe("the storage notice flag", () => {
  it("is unset until saved, then set", () => {
    const storage = new InMemoryStorage();
    assert.equal(readStorageNoticeSeen(storage), false);
    assert.equal(saveStorageNoticeSeen(storage), "saved");
    assert.equal(readStorageNoticeSeen(storage), true);
  });

  it("doesn't touch the favorites and records", () => {
    const storage = new InMemoryStorage();
    const data = withFavoriteAdded(EMPTY_PERSONAL_DATA, 13n);
    savePersonalData(storage, data);
    saveStorageNoticeSeen(storage);
    assert.deepEqual(readStoredPersonalData(storage), data);
  });

  it("reports storage that throws as unknown, without crashing", () => {
    const blocked = new ThrowingStorage(new DOMException("denied", "SecurityError"));
    assert.equal(readStorageNoticeSeen(blocked), null);
    assert.equal(readStorageNoticeSeen(null), null);
    assert.equal(saveStorageNoticeSeen(blocked), "storage-unavailable");
    const full = new ThrowingStorage(new DOMException("full", "QuotaExceededError"));
    assert.equal(saveStorageNoticeSeen(full), "storage-full");
  });
});
