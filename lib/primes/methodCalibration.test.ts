import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CAPS_TO_TRY,
  findFastestCap,
  findPartialSieveStart,
  FIRST_LADDER_BITS,
  LADDER_STEP_BITS,
  RUNS_PER_MEASUREMENT,
  type TimedBatch,
} from "./methodCalibration.ts";

const CAP = 65_536n;
const PRIMES = [101n, 103n, 107n];
const batch = (durationMs: number, primes: readonly bigint[] = PRIMES): TimedBatch => ({ durationMs, primes });
const rung = (step: number) => 1n << BigInt(FIRST_LADDER_BITS + step * LADDER_STEP_BITS);

describe("findPartialSieveStart", () => {
  it("stops at the first rung where partial sieving is clearly faster", () => {
    // full doubles per rung; partial stays at 8 ms, so it wins at 16 ms: rung 3
    const result = findPartialSieveStart(
      (from) => batch(from === rung(0) ? 2 : from === rung(1) ? 4 : from === rung(2) ? 8 : 16),
      () => batch(8),
      CAP,
    );
    assert.deepEqual(result, { agreed: true, partialSieveFrom: rung(3) });
  });

  it("builds nothing above that rung: the full sieve is never timed past it", () => {
    const timed: bigint[] = [];
    findPartialSieveStart(
      (from) => (timed.push(from), batch(from === rung(0) ? 1 : 100)),
      () => batch(10),
      CAP,
    );
    assert.deepEqual([...new Set(timed)], [rung(0), rung(1)]);
  });

  it("needs partial sieving to be clearly faster: a tie or a 5% lead isn't a win", () => {
    const fullMs = (from: bigint) => (from === rung(2) ? 100 : 10);
    const partialMs = (from: bigint) => (from === rung(0) ? 10 : from === rung(1) ? 9.5 : 50);
    const result = findPartialSieveStart(
      (from) => batch(fullMs(from)),
      (from) => batch(partialMs(from)),
      CAP,
    );
    assert.deepEqual(result, { agreed: true, partialSieveFrom: rung(2) });
  });

  it("doesn't take 0 ms against 0 ms, from a coarse timer, as a win", () => {
    const result = findPartialSieveStart(
      (from) => batch(from === rung(0) ? 0 : 10),
      () => batch(0),
      CAP,
    );
    assert.deepEqual(result, { agreed: true, partialSieveFrom: rung(1) });
  });

  it("keeps the fastest of its runs, so one slow run can't decide", () => {
    let fullRuns = 0;
    const result = findPartialSieveStart(
      // the full sieve is fast at the first rung, with one run slowed by noise
      (from) => (from === rung(0) ? batch(++fullRuns === 1 ? 1000 : 1) : batch(100)),
      () => batch(10),
      CAP,
    );
    assert.deepEqual(result, { agreed: true, partialSieveFrom: rung(1) });
  });

  it("times each method the same number of times", () => {
    let fullRuns = 0;
    let partialRuns = 0;
    findPartialSieveStart(
      () => (fullRuns++, batch(100)),
      () => (partialRuns++, batch(1)),
      CAP,
    );
    assert.equal(fullRuns, RUNS_PER_MEASUREMENT);
    assert.equal(partialRuns, RUNS_PER_MEASUREMENT);
  });

  it("starts sieving partially where the full sieve stops fitting, whichever method is faster", () => {
    const result = findPartialSieveStart(
      (from) => (from === rung(2) ? null : batch(1)),
      () => batch(50),
      CAP,
    );
    assert.deepEqual(result, { agreed: true, partialSieveFrom: rung(2) });
  });

  it("tries a full sieve that doesn't fit only once: a failed build can take minutes", () => {
    let attempts = 0;
    findPartialSieveStart(
      () => (attempts++, null),
      () => batch(1),
      CAP,
    );
    assert.equal(attempts, 1);
  });

  it("uses the cap it's given", () => {
    const caps: bigint[] = [];
    findPartialSieveStart(
      () => batch(100),
      (_from, cap) => (caps.push(cap), batch(1)),
      12_345n,
    );
    assert.deepEqual([...new Set(caps)], [12_345n]);
  });

  it("reports the place when the methods' primes differ, even if partial sieving is faster", () => {
    const result = findPartialSieveStart(
      () => batch(100),
      () => batch(1, [101n, 103n, 109n]),
      CAP,
    );
    assert.deepEqual(result, { agreed: false, from: rung(0) });
  });

  it("notices one prime missing, and a run of the same method that differs", () => {
    assert.equal(findPartialSieveStart(() => batch(100), () => batch(1, [101n, 103n]), CAP).agreed, false);
    let fullRuns = 0;
    const result = findPartialSieveStart(
      () => batch(100, ++fullRuns === 2 ? [101n] : PRIMES),
      () => batch(1),
      CAP,
    );
    assert.equal(result.agreed, false);
  });
});

describe("findFastestCap", () => {
  const FROM = 2n ** 66n;

  it("tries every cap, and picks the fastest", () => {
    const tried = new Set<bigint>();
    const result = findFastestCap((_from, cap) => (tried.add(cap), batch(cap === 2n ** 16n ? 5 : 9)), FROM);
    assert.deepEqual(result, { agreed: true, cap: 2n ** 16n });
    assert.deepEqual([...tried], CAPS_TO_TRY);
  });

  it("gives a tie to the smallest cap, which holds the fewest base primes", () => {
    assert.deepEqual(findFastestCap(() => batch(5), FROM), { agreed: true, cap: CAPS_TO_TRY[0] });
  });

  it("keeps the fastest of its runs for each cap", () => {
    let runsOfBestCap = 0;
    const result = findFastestCap(
      (_from, cap) => (cap === 2n ** 18n ? batch(++runsOfBestCap === 1 ? 1000 : 1) : batch(5)),
      FROM,
    );
    assert.deepEqual(result, { agreed: true, cap: 2n ** 18n });
  });

  it("times it at the place it's given", () => {
    const places = new Set<bigint>();
    findFastestCap((from) => (places.add(from), batch(5)), FROM);
    assert.deepEqual([...places], [FROM]);
  });

  it("reports the place when two caps' primes differ", () => {
    const result = findFastestCap((_from, cap) => batch(5, cap === 2n ** 18n ? [101n] : PRIMES), FROM);
    assert.deepEqual(result, { agreed: false, from: FROM });
  });
});
