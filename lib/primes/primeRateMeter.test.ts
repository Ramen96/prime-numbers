import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPTY_RATE_WINDOW,
  MAX_WINDOW_BATCHES,
  MIN_WINDOW_DURATION_MS,
  measurePrimesPerSecond,
  recordBatch,
  type RateWindow,
} from "./primeRateMeter.ts";

const PRIMES_PER_BATCH = 500;

/**
 * What a worker would measure for back-to-back batches when the browser
 * rounds performance.now() down to `timerStepMicroseconds`. Works in whole
 * microseconds so the simulation itself has no floating-point drift.
 */
function measureWithRoundedTimer(
  trueDurationsMicroseconds: number[],
  timerStepMicroseconds: number,
): number[] {
  const roundDown = (microseconds: number) =>
    Math.floor(microseconds / timerStepMicroseconds) * timerStepMicroseconds;
  let clockMicroseconds = 0;
  return trueDurationsMicroseconds.map((trueDuration) => {
    const measuredStart = roundDown(clockMicroseconds);
    clockMicroseconds += trueDuration;
    const measuredEnd = roundDown(clockMicroseconds);
    return (measuredEnd - measuredStart) / 1000; // → ms
  });
}

function recordAll(window: RateWindow, measuredDurationsMs: number[]): RateWindow {
  return measuredDurationsMs.reduce(
    (currentWindow, sievingDurationMs) =>
      recordBatch(currentWindow, { primeCount: PRIMES_PER_BATCH, sievingDurationMs, setupDurationMs: 0 }),
    window,
  );
}

function trueRate(trueDurationMicroseconds: number): number {
  return PRIMES_PER_BATCH / (trueDurationMicroseconds / 1_000_000);
}

function assertWithinPercent(actual: number | null, expected: number, percent: number) {
  assert.ok(actual !== null, "expected a rate, got none");
  const errorPercent = (Math.abs(actual - expected) / expected) * 100;
  assert.ok(
    errorPercent <= percent,
    `expected ${expected.toFixed(0)} ± ${percent}%, got ${actual.toFixed(0)} (${errorPercent.toFixed(1)}% off)`,
  );
}

describe("primeRateMeter", () => {
  describe("with a coarse timer, where most batches measure 0 ms", () => {
    for (const { timerName, timerStepMicroseconds, trueBatchMicroseconds } of [
      { timerName: "0.1 ms timer", timerStepMicroseconds: 100, trueBatchMicroseconds: 30 },
      { timerName: "1 ms timer", timerStepMicroseconds: 1000, trueBatchMicroseconds: 300 },
    ]) {
      it(`gives a stable rate close to the true average with a ${timerName}`, () => {
        const measuredDurationsMs = measureWithRoundedTimer(
          Array(400).fill(trueBatchMicroseconds),
          timerStepMicroseconds,
        );
        const zeroBatches = measuredDurationsMs.filter((duration) => duration === 0).length;
        assert.ok(zeroBatches > measuredDurationsMs.length / 2, "most batches should measure 0 ms");

        // Once the window is full, every reading should be close to the truth.
        let window = recordAll(EMPTY_RATE_WINDOW, measuredDurationsMs.slice(0, MAX_WINDOW_BATCHES));
        for (const sievingDurationMs of measuredDurationsMs.slice(MAX_WINDOW_BATCHES)) {
          window = recordBatch(window, { primeCount: PRIMES_PER_BATCH, sievingDurationMs, setupDurationMs: 0 });
          assertWithinPercent(measurePrimesPerSecond(window), trueRate(trueBatchMicroseconds), 12);
        }
      });
    }

    it("counts 0 ms batches instead of dropping them or treating them as infinitely fast", () => {
      const window = recordAll(EMPTY_RATE_WINDOW, [0, 0, 0, 0.1]);
      // 4 batches × 500 primes over 0.1 ms total.
      assert.equal(measurePrimesPerSecond(window), 2000 / 0.0001);
    });
  });

  it("ignores setup time: building base primes doesn't drag the rate down", () => {
    // A big jump's first batch: 64 ms building base primes, then 30 ms sieving,
    // then a 25 ms batch. Together they're needed to cover 50 ms of sieving.
    let window = recordBatch(EMPTY_RATE_WINDOW, {
      primeCount: PRIMES_PER_BATCH,
      sievingDurationMs: 30,
      setupDurationMs: 64,
    });
    window = recordBatch(window, { primeCount: PRIMES_PER_BATCH, sievingDurationMs: 25, setupDurationMs: 0 });
    assert.equal(window.length, 2);
    assertWithinPercent(measurePrimesPerSecond(window), 1000 / 0.055, 0.001); // 1,000 primes in 55 ms of sieving
  });

  it("shows no rate when everything in the window measured 0 ms", () => {
    assert.equal(measurePrimesPerSecond(EMPTY_RATE_WINDOW), null);
    assert.equal(measurePrimesPerSecond(recordAll(EMPTY_RATE_WINDOW, [0, 0, 0])), null);
  });

  it("holds the rate steady while idle: nothing decays it over time", () => {
    const window = recordAll(EMPTY_RATE_WINDOW, Array(10).fill(2));
    const rateWhenScrollingStopped = measurePrimesPerSecond(window);
    // No batches arrive while the user isn't scrolling, so nothing changes the
    // window, and the rate doesn't depend on the clock.
    assert.equal(measurePrimesPerSecond(window), rateWhenScrollingStopped);
    assert.equal(rateWhenScrollingStopped, 250_000);
  });

  it("after a jump resets the window, the rate reflects only the new region", () => {
    const fastWindowBeforeJump = recordAll(EMPTY_RATE_WINDOW, Array(20).fill(0.05));
    const windowAfterJump = recordAll(EMPTY_RATE_WINDOW, [400]); // a slow batch far away
    assert.equal(measurePrimesPerSecond(windowAfterJump), PRIMES_PER_BATCH / 0.4);
    assert.notEqual(measurePrimesPerSecond(fastWindowBeforeJump), measurePrimesPerSecond(windowAfterJump));
  });

  describe("window size", () => {
    it(`keeps at least ${MIN_WINDOW_DURATION_MS} ms of measured time when it can`, () => {
      const window = recordAll(EMPTY_RATE_WINDOW, Array(30).fill(4));
      const windowDurationMs = window.reduce((sum, batch) => sum + batch.sievingDurationMs, 0);
      assert.ok(windowDurationMs >= MIN_WINDOW_DURATION_MS);
      assert.ok(windowDurationMs - 4 < MIN_WINDOW_DURATION_MS, "but no more than it needs");
    });

    it("drops old fast batches as soon as one slow batch covers the minimum time", () => {
      let window = recordAll(EMPTY_RATE_WINDOW, Array(MAX_WINDOW_BATCHES).fill(0.05));
      window = recordBatch(window, { primeCount: PRIMES_PER_BATCH, sievingDurationMs: 80, setupDurationMs: 0 });
      assert.equal(window.length, 1);
      assert.equal(measurePrimesPerSecond(window), PRIMES_PER_BATCH / 0.08);
    });

    it(`caps at ${MAX_WINDOW_BATCHES} batches, so the rate catches up with a slowdown within that many batches`, () => {
      // Lots of very fast batches that never add up to the minimum time...
      let window = recordAll(EMPTY_RATE_WINDOW, Array(1000).fill(0.01));
      assert.equal(window.length, MAX_WINDOW_BATCHES);
      // ...then the numbers get bigger and each batch takes 4× as long.
      const slowerBatchMs = 0.04;
      window = recordAll(window, Array(MAX_WINDOW_BATCHES / 4).fill(slowerBatchMs));
      const rateAfterAQuarterOfTheWindow = measurePrimesPerSecond(window)!;
      window = recordAll(window, Array(MAX_WINDOW_BATCHES).fill(slowerBatchMs));

      assertWithinPercent(measurePrimesPerSecond(window), PRIMES_PER_BATCH / (slowerBatchMs / 1000), 0.001);
      assert.ok(
        rateAfterAQuarterOfTheWindow < (PRIMES_PER_BATCH / 0.01) * 1000 * 0.7,
        "already well on its way down after a few batches",
      );
    });
  });
});
