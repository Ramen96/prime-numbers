import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  joinVerifications,
  SMALLEST_PRIME_WORTH_SHARING,
  splitIntoShares,
  VerificationPool,
  type VerificationRequest,
} from "./verificationPool.ts";
import { verifyPrimes } from "./verifyPrimes.ts";

/** A stand-in worker that verifies for real, or fails, and records what it was sent. */
function standInWorker(sent: bigint[][], options: { fails?: boolean } = {}): Worker {
  const worker = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as ((event: { message: string; preventDefault(): void }) => void) | null,
    terminated: false,
    postMessage({ primes }: VerificationRequest) {
      sent.push(primes);
      queueMicrotask(() => {
        if (options.fails) worker.onerror?.({ message: "failed to load", preventDefault() {} });
        else worker.onmessage?.({ data: { verification: verifyPrimes(primes) } });
      });
    },
    terminate() {
      worker.terminated = true;
    },
  };
  return worker as unknown as Worker;
}

const BIG = SMALLEST_PRIME_WORTH_SHARING;
// primes just past 2^32: 4294967311, 4294967357, 4294967371, 4294967377, 4294967387, 4294967389
const BIG_PRIMES = [15n, 61n, 75n, 81n, 91n, 93n].map((offset) => BIG + offset);

describe("splitIntoShares", () => {
  it("splits into consecutive, even shares that rebuild the batch in order", () => {
    const batch = Array.from({ length: 500 }, (_, index) => index);
    for (const shareCount of [1, 2, 3, 7, 9]) {
      const shares = splitIntoShares(batch, shareCount);
      assert.equal(shares.length, shareCount);
      assert.deepEqual(shares.flat(), batch);
      const sizes = shares.map((share) => share.length);
      assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
    }
  });

  it("never makes an empty share", () => {
    assert.deepEqual(splitIntoShares([1, 2], 9), [[1], [2]]);
  });
});

describe("joinVerifications", () => {
  it("reports the first disputed prime in batch order", () => {
    const joined = joinVerifications([
      { verified: true },
      { verified: false, disputedPrime: 21n, verdict: "composite" },
      { verified: false, disputedPrime: 99n, verdict: "composite" },
    ]);
    assert.deepEqual(joined, { verified: false, disputedPrime: 21n, verdict: "composite" });
    assert.deepEqual(joinVerifications([{ verified: true }, { verified: true }]), { verified: true });
  });
});

describe("VerificationPool", () => {
  it("checks small primes inline, without starting workers", async () => {
    let started = 0;
    const pool = new VerificationPool(4, () => (started++, standInWorker([])));
    assert.deepEqual(await pool.verify([2n, 3n, 5n]), { verified: true });
    assert.equal(started, 0);
  });

  it("shares big primes between its workers, and every prime is checked once", async () => {
    const sent: bigint[][] = [];
    const pool = new VerificationPool(3, () => standInWorker(sent));
    assert.deepEqual(await pool.verify(BIG_PRIMES), { verified: true });
    assert.equal(sent.length, 3);
    assert.deepEqual(sent.flat(), BIG_PRIMES);
  });

  it("finds a composite whichever share it's in", async () => {
    const composite = BIG + 17n; // 4294967313 = 3 × 1431655771
    const pool = new VerificationPool(3, () => standInWorker([]));
    const batch = [...BIG_PRIMES.slice(0, 4), composite];
    assert.deepEqual(await pool.verify(batch), { verified: false, disputedPrime: composite, verdict: "composite" });
  });

  it("checks inline from then on if a worker fails, never skipping the check", async () => {
    let started = 0;
    const pool = new VerificationPool(2, () => (started++, standInWorker([], { fails: true })));
    assert.deepEqual(await pool.verify(BIG_PRIMES), { verified: true });
    const composite = BIG + 17n;
    assert.equal((await pool.verify([composite])).verified, false);
    assert.equal(started, 2, "no new workers after the failure");
  });

  it("checks inline with fewer than 2 workers", async () => {
    let started = 0;
    const pool = new VerificationPool(1, () => (started++, standInWorker([])));
    assert.deepEqual(await pool.verify(BIG_PRIMES), { verified: true });
    assert.equal(started, 0);
  });
});
