import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimatePrimeOrdinal } from "./logarithmicIntegral.ts";
import {
  addBatch,
  bufferLabelsAreEstimated,
  MAX_BATCHES,
  type Batch,
} from "./rollingBuffer.ts";

const BATCH_SIZE = 500;

// ── reference primes for building realistic batches ──────────────────────

const SIEVE_LIMIT = 1_100_000;
const ALL_PRIMES_BELOW_LIMIT: number[] = (() => {
  const isComposite = new Uint8Array(SIEVE_LIMIT);
  const primes: number[] = [];
  for (let candidate = 2; candidate < SIEVE_LIMIT; candidate++) {
    if (isComposite[candidate]) continue;
    primes.push(candidate);
    for (let multiple = candidate * candidate; multiple < SIEVE_LIMIT; multiple += candidate) {
      isComposite[multiple] = 1;
    }
  }
  return primes;
})();

/** Same contract as the worker's "next": up to `count` primes strictly greater than `from`. */
function primesAfter(from: number, count = BATCH_SIZE): Float64Array {
  const startPosition = ALL_PRIMES_BELOW_LIMIT.findIndex((prime) => prime > from);
  return Float64Array.from(ALL_PRIMES_BELOW_LIMIT.slice(startPosition, startPosition + count));
}

/** Same contract as the worker's "prev": up to `count` primes strictly less than `from`, ascending. */
function primesBefore(from: number, count = BATCH_SIZE): Float64Array {
  const endPosition = ALL_PRIMES_BELOW_LIMIT.findIndex((prime) => prime >= from);
  return Float64Array.from(
    ALL_PRIMES_BELOW_LIMIT.slice(Math.max(0, endPosition - count), endPosition),
  );
}

/** The exact position of a prime, 2 being #1. */
function exactOrdinalOf(prime: number): number {
  return ALL_PRIMES_BELOW_LIMIT.indexOf(prime) + 1;
}

// ── helpers that act like the hook ───────────────────────────────────────

function jumpTo(target: number): Batch[] {
  return addBatch([], primesAfter(target - 1), "next").batches;
}

function scrollDownOneBatch(batches: Batch[]): Batch[] {
  const lastBatch = batches[batches.length - 1];
  const largestPrimeHeld = lastBatch.primes[lastBatch.primes.length - 1];
  return addBatch(batches, primesAfter(largestPrimeHeld), "next").batches;
}

function scrollUpOneBatch(batches: Batch[]): Batch[] {
  const smallestPrimeHeld = batches[0].primes[0];
  return addBatch(batches, primesBefore(smallestPrimeHeld), "prev").batches;
}

/** Every prime in the buffer with its label, top to bottom. */
function labelledRows(batches: Batch[]) {
  return batches.flatMap((batch) =>
    Array.from(batch.primes, (prime, positionInBatch) => ({
      prime,
      ordinal: batch.ordinalOfFirstPrime + positionInBatch,
      isEstimate: batch.ordinalIsEstimate,
    })),
  );
}

function assertLabelsConsecutive(batches: Batch[]) {
  const rows = labelledRows(batches);
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const rowAbove = rows[rowIndex - 1];
    const row = rows[rowIndex];
    assert.equal(
      row.ordinal - rowAbove.ordinal,
      1,
      `labels jump between ${rowAbove.prime} (#${rowAbove.ordinal}) and ${row.prime} (#${row.ordinal})`,
    );
  }
}

// ── tests ────────────────────────────────────────────────────────────────

describe("labels after a jump", () => {
  const anchorPrime = 1_000_003; // first prime ≥ 1,000,000

  it("estimates the anchor's position once with li(x), and marks it as an estimate", () => {
    const [seedBatch] = jumpTo(1_000_000);
    assert.equal(seedBatch.primes[0], anchorPrime);
    assert.equal(seedBatch.ordinalOfFirstPrime, estimatePrimeOrdinal(anchorPrime));
    assert.equal(seedBatch.ordinalIsEstimate, true);
  });

  it("the estimate is close: within 0.2% of the exact position", () => {
    const [seedBatch] = jumpTo(1_000_000);
    const exact = exactOrdinalOf(anchorPrime); // 78,499
    assert.ok(Math.abs(seedBatch.ordinalOfFirstPrime - exact) / exact < 0.002);
  });

  it("stay consecutive across batch boundaries scrolling up", () => {
    let batches = jumpTo(1_000_000);
    for (let step = 0; step < 5; step++) {
      batches = scrollUpOneBatch(batches);
      assertLabelsConsecutive(batches);
      assert.ok(batches.every((batch) => batch.ordinalIsEstimate));
    }
  });

  it("stay consecutive across batch boundaries scrolling down", () => {
    let batches = jumpTo(1_000_000);
    for (let step = 0; step < 5; step++) {
      batches = scrollDownOneBatch(batches);
      assertLabelsConsecutive(batches);
      assert.ok(batches.every((batch) => batch.ordinalIsEstimate));
    }
  });

  it("keep the anchor's label fixed no matter which way the user scrolls", () => {
    const anchorLabel = estimatePrimeOrdinal(anchorPrime);
    const labelOfAnchor = (batches: Batch[]) =>
      labelledRows(batches).find((row) => row.prime === anchorPrime)?.ordinal;

    let batches = jumpTo(1_000_000);
    batches = scrollUpOneBatch(batches);
    batches = scrollDownOneBatch(batches);
    assert.equal(labelOfAnchor(batches), anchorLabel);
    batches = scrollUpOneBatch(batches);
    assert.equal(labelOfAnchor(batches), anchorLabel);
  });

  it("stay consecutive when batches are dropped to keep the buffer at MAX_BATCHES", () => {
    let batches = jumpTo(1_000_000);
    for (let step = 0; step < 4; step++) batches = scrollDownOneBatch(batches);
    assert.equal(batches.length, MAX_BATCHES);
    assertLabelsConsecutive(batches);
    for (let step = 0; step < 8; step++) batches = scrollUpOneBatch(batches);
    assert.equal(batches.length, MAX_BATCHES);
    assertLabelsConsecutive(batches);
  });
});

describe("labels become exact once 2 is in the buffer", () => {
  it("after scrolling all the way back down to 2", () => {
    let batches = jumpTo(1_000_000);
    while (batches[0].primes[0] !== 2) {
      batches = scrollUpOneBatch(batches);
    }
    const rows = labelledRows(batches);
    assert.ok(rows.every((row) => !row.isEstimate));
    assert.deepEqual(rows[0], { prime: 2, ordinal: 1, isEstimate: false });
    for (const row of rows) assert.equal(row.ordinal, exactOrdinalOf(row.prime));
  });

  it("and stay exact when scrolling back down after that", () => {
    let batches = jumpTo(2_000);
    while (batches[0].primes[0] !== 2) batches = scrollUpOneBatch(batches);
    for (let step = 0; step < 5; step++) batches = scrollDownOneBatch(batches);
    assert.ok(batches[0].primes[0] !== 2, "2 should have been dropped by now");
    for (const row of labelledRows(batches)) {
      assert.equal(row.isEstimate, false);
      assert.equal(row.ordinal, exactOrdinalOf(row.prime));
    }
  });

  it("right away when jumping to a small number whose batch below reaches 2", () => {
    let batches = jumpTo(100);
    batches = scrollUpOneBatch(batches); // the hook requests this immediately after a jump
    const rows = labelledRows(batches);
    assert.ok(rows.every((row) => !row.isEstimate));
    assert.equal(rows.find((row) => row.prime === 101)?.ordinal, 26);
  });

  it("from the start of the app (never jumped)", () => {
    const batches = jumpTo(2); // the initial load seeds the buffer at 2
    const rows = labelledRows(batches);
    assert.deepEqual(rows[0], { prime: 2, ordinal: 1, isEstimate: false });
    assert.ok(rows.every((row) => !row.isEstimate));
  });
});

describe("rowsAddedAbove", () => {
  it("is −500 when a batch is dropped from the top, +500 when one is added there", () => {
    let batches = jumpTo(1_000_000);
    batches = scrollDownOneBatch(batches);
    batches = scrollDownOneBatch(batches);
    const lastBatch = batches[batches.length - 1];
    const droppingTop = addBatch(batches, primesAfter(lastBatch.primes[BATCH_SIZE - 1]), "next");
    assert.equal(droppingTop.rowsAddedAbove, -BATCH_SIZE);
    const addingTop = addBatch(batches, primesBefore(batches[0].primes[0]), "prev");
    assert.equal(addingTop.rowsAddedAbove, BATCH_SIZE);
  });
});

describe("estimate banner visibility (bufferLabelsAreEstimated)", () => {
  // The first few primes above 10^12. The reference sieve doesn't reach that
  // far, but a jump only needs the batch's first prime to place its anchor.
  const PRIMES_ABOVE_ONE_TRILLION = Float64Array.from([
    1_000_000_000_039, 1_000_000_000_061, 1_000_000_000_063,
  ]);

  it("is hidden on app start", () => {
    assert.equal(bufferLabelsAreEstimated([]), false); // before the first batch arrives
    assert.equal(bufferLabelsAreEstimated(jumpTo(2)), false); // the initial load seeds at 2
  });

  it("is shown after jumping to 10^12", () => {
    const { batches } = addBatch([], PRIMES_ABOVE_ONE_TRILLION, "next");
    assert.equal(bufferLabelsAreEstimated(batches), true);
  });

  it("is hidden after jumping to 100", () => {
    let batches = jumpTo(100);
    batches = scrollUpOneBatch(batches); // the hook requests this immediately after a jump
    assert.equal(bufferLabelsAreEstimated(batches), false);
  });

  it("hides once the user scrolls back to 2, and stays hidden scrolling forward", () => {
    let batches = jumpTo(1_000_000);
    while (batches[0].primes[0] !== 2) {
      assert.equal(bufferLabelsAreEstimated(batches), true);
      batches = scrollUpOneBatch(batches);
    }
    assert.equal(bufferLabelsAreEstimated(batches), false);
    for (let step = 0; step < 5; step++) {
      batches = scrollDownOneBatch(batches);
      assert.equal(bufferLabelsAreEstimated(batches), false);
    }
  });

  it("is hidden during normal scrolling from 2", () => {
    let batches = jumpTo(2);
    for (let step = 0; step < 5; step++) {
      batches = scrollDownOneBatch(batches);
      assert.equal(bufferLabelsAreEstimated(batches), false);
    }
  });
});
