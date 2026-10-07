// Favorite primes and personal records, kept in this browser's localStorage
// and nowhere else. Pure functions, no React, so they can be unit tested.
//
// Every prime is stored as a decimal string, never a JS number, so values of
// any size stay exact (CLAUDE.md, Requirement B). Comparisons go through BigInt.

export const PERSONAL_DATA_STORAGE_KEY = "everyPrimeNumber.personalData";
/** Bump when the stored format changes. Data with any other version is ignored and replaced. */
export const PERSONAL_DATA_VERSION = 1;

export interface PersonalRecords {
  /** The largest prime reached by scrolling continuously from 2, with no jump. */
  furthestScroll: string | null;
  /** The largest prime that has been on screen, jumps included. */
  biggestPrimeVisited: string | null;
}

export interface PersonalData {
  /** Decimal strings, ascending, no duplicates. */
  favorites: readonly string[];
  records: PersonalRecords;
}

export const EMPTY_PERSONAL_DATA: PersonalData = {
  favorites: [],
  records: { furthestScroll: null, biggestPrimeVisited: null },
};

/** The parts of localStorage used here, so tests can pass a stand-in. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type SaveResult = "saved" | "storage-full" | "storage-unavailable";

const DECIMAL_INTEGER = /^(0|[1-9]\d*)$/;

function isDecimalInteger(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_INTEGER.test(value);
}

function decimalOrNull(value: unknown): string | null {
  return isDecimalInteger(value) ? value : null;
}

function compareDecimals(first: string, second: string): number {
  const difference = BigInt(first) - BigInt(second);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function sortedWithoutDuplicates(decimals: readonly string[]): string[] {
  return [...new Set(decimals)].sort(compareDecimals);
}

/** The larger of a stored record and a new value. */
export function largerDecimal(current: string | null, candidate: string | null): string | null {
  if (current === null) return candidate;
  if (candidate === null) return current;
  return compareDecimals(candidate, current) > 0 ? candidate : current;
}

/**
 * Turns what's in storage back into personal data. Anything malformed, or
 * saved in a different version's format, is ignored (and replaced on the next
 * save); individual bad entries are dropped.
 */
export function parsePersonalData(serialized: string | null): PersonalData {
  if (serialized === null) return EMPTY_PERSONAL_DATA;
  try {
    const stored: unknown = JSON.parse(serialized);
    if (typeof stored !== "object" || stored === null) return EMPTY_PERSONAL_DATA;
    const { version, favorites, records } = stored as Record<string, unknown>;
    if (version !== PERSONAL_DATA_VERSION) return EMPTY_PERSONAL_DATA;

    const storedRecords =
      typeof records === "object" && records !== null ? (records as Record<string, unknown>) : {};
    return {
      favorites: Array.isArray(favorites) ? sortedWithoutDuplicates(favorites.filter(isDecimalInteger)) : [],
      records: {
        furthestScroll: decimalOrNull(storedRecords.furthestScroll),
        biggestPrimeVisited: decimalOrNull(storedRecords.biggestPrimeVisited),
      },
    };
  } catch {
    return EMPTY_PERSONAL_DATA;
  }
}

export function serializePersonalData(data: PersonalData): string {
  return JSON.stringify({
    version: PERSONAL_DATA_VERSION,
    favorites: data.favorites,
    records: data.records,
  });
}

/** What's stored, or null if storage can't be read at all (blocked, private mode). */
export function readStoredPersonalData(storage: KeyValueStorage | null): PersonalData | null {
  if (!storage) return null;
  try {
    return parsePersonalData(storage.getItem(PERSONAL_DATA_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function savePersonalData(storage: KeyValueStorage | null, data: PersonalData): SaveResult {
  if (!storage) return "storage-unavailable";
  try {
    storage.setItem(PERSONAL_DATA_STORAGE_KEY, serializePersonalData(data));
    return "saved";
  } catch (error) {
    return isStorageFullError(error) ? "storage-full" : "storage-unavailable";
  }
}

/** Browsers name the "storage is full" error differently. */
function isStorageFullError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return (
    error.name === "QuotaExceededError" ||
    error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error.code === 22 ||
    error.code === 1014
  );
}

// ── the storage notice ──────────────────────────────────────────────────

/** Kept apart from favorites and records, so it never touches their versioned format. */
export const STORAGE_NOTICE_SEEN_KEY = "everyPrimeNumber.storageNoticeSeen";

/** Whether the storage notice has been shown before, or null if storage can't be read. */
export function readStorageNoticeSeen(storage: KeyValueStorage | null): boolean | null {
  if (!storage) return null;
  try {
    return storage.getItem(STORAGE_NOTICE_SEEN_KEY) === "yes";
  } catch {
    return null;
  }
}

export function saveStorageNoticeSeen(storage: KeyValueStorage | null): SaveResult {
  if (!storage) return "storage-unavailable";
  try {
    storage.setItem(STORAGE_NOTICE_SEEN_KEY, "yes");
    return "saved";
  } catch (error) {
    return isStorageFullError(error) ? "storage-full" : "storage-unavailable";
  }
}

// ── changes ─────────────────────────────────────────────────────────────

export function isFavorite(data: PersonalData, prime: bigint): boolean {
  return data.favorites.includes(prime.toString());
}

export function withFavoriteAdded(data: PersonalData, prime: bigint): PersonalData {
  return { ...data, favorites: sortedWithoutDuplicates([...data.favorites, prime.toString()]) };
}

export function withFavoriteRemoved(data: PersonalData, prime: bigint): PersonalData {
  const removed = prime.toString();
  return { ...data, favorites: data.favorites.filter((favorite) => favorite !== removed) };
}

/** Keeps the larger of each record, e.g. when another tab has saved meanwhile. */
export function withRecordsMerged(data: PersonalData, records: PersonalRecords): PersonalData {
  return {
    ...data,
    records: {
      furthestScroll: largerDecimal(data.records.furthestScroll, records.furthestScroll),
      biggestPrimeVisited: largerDecimal(data.records.biggestPrimeVisited, records.biggestPrimeVisited),
    },
  };
}

export function withRecordsCleared(data: PersonalData): PersonalData {
  return { ...data, records: EMPTY_PERSONAL_DATA.records };
}
