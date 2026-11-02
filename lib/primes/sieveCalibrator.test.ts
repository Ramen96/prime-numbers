import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBasePrimes, PARTIAL_SIEVE_PRIME_CAP, SieveCalibrator } from "./sieveCalibrator.ts";
import { NO_SIEVE_PRIME_CAP } from "./wasmSieve.ts";
import type { Sieve } from "./computeBatch.ts";

const SWITCH_RUNG = 2n ** 44n; // the stand-in's full sieve loses from here
const BEST_CAP = 2n ** 18n;
const BEST_MULTI_LIMB_CAP = 2n ** 14n;

/**
 * A stand-in sieve on a fake clock: each batch advances it by what that
 * method costs there, and every batch holds the same primes unless told not to.
 */
function fakeDevice(options: { differAt?: bigint; differingCap?: bigint; extends?: boolean } = {}) {
  let clock = 0;
  let cap = NO_SIEVE_PRIME_CAP;
  const batches: { from: bigint; cap: bigint }[] = [];
  const builds: bigint[] = [];
  const sieve: Sieve = {
    basePrimeLimit: () => 0n,
    extendBasePrimes: (limit) => (builds.push(limit), options.extends ?? true),
    reserveBasePrimeStorage: () => true,
    basePrimeMemoryBytes: () => 0,
    moduleMemoryBytes: () => 0,
    setSievePrimeCap: (newCap) => void (cap = newCap),
    findPrimes: (_direction, from) => {
      batches.push({ from, cap });
      const best = from >= 2n ** 64n ? BEST_MULTI_LIMB_CAP : BEST_CAP;
      clock += cap === NO_SIEVE_PRIME_CAP ? (from < SWITCH_RUNG ? 1 : 100) : cap === best ? 5 : 10;
      clock += 1000; // spent measuring thread splits: must be left out
      const differs = options.differAt === from && cap !== NO_SIEVE_PRIME_CAP && cap === (options.differingCap ?? cap);
      return {
        primes: [from + 1n, differs ? from + 5n : from + 3n],
        rejected: [],
        reachedMemoryLimit: false,
        reachedProvenBound: false,
        measuringMs: 1000,
      };
    },
  };
  // every read of the clock moves it a little, as a real one does
  return { sieve, batches, builds, now: () => (clock += 0.001) };
}

describe("SieveCalibrator", () => {
  it("measures nothing below 2^32: the full sieve", () => {
    const device = fakeDevice();
    const calibrator = new SieveCalibrator(device.sieve, null, device.now);
    assert.deepEqual(calibrator.capFor(2n ** 32n - 1n), { agreed: true, cap: null, setupMs: 0 });
    assert.deepEqual(device.batches, []);
  });

  it("past 2^32, measures once, and uses the result either side of the switch", () => {
    const device = fakeDevice();
    const calibrator = new SieveCalibrator(device.sieve, null, device.now);
    const below = calibrator.capFor(2n ** 40n);
    assert.ok(below.agreed && below.cap === null && below.setupMs > 0, "below the switch: full sieve, setup counted");
    const batchesTimed = device.batches.length;
    assert.deepEqual(calibrator.capFor(2n ** 41n), { agreed: true, cap: null, setupMs: 0 });
    assert.deepEqual(calibrator.capFor(SWITCH_RUNG), { agreed: true, cap: BEST_CAP, setupMs: 0 });
    assert.deepEqual(calibrator.capFor(2n ** 63n), { agreed: true, cap: BEST_CAP, setupMs: 0 });
    assert.equal(device.batches.length, batchesTimed, "measured once");
  });

  it("leaves thread-split measuring out of what it compares", () => {
    const device = fakeDevice(); // 1,000 ms of it on every batch would otherwise swamp the difference
    const calibrator = new SieveCalibrator(device.sieve, null, device.now);
    calibrator.capFor(2n ** 40n);
    assert.deepEqual(calibrator.capFor(SWITCH_RUNG), { agreed: true, cap: BEST_CAP, setupMs: 0 });
  });

  it("builds base primes only up to the switch: none near 2^63, even if that's the first jump", () => {
    const device = fakeDevice();
    new SieveCalibrator(device.sieve, null, device.now).capFor(2n ** 63n);
    assert.ok(device.builds.every((limit) => limit * limit < SWITCH_RUNG * 2n), device.builds.join());
    assert.ok(device.batches.every(({ from }) => from <= SWITCH_RUNG));
  });

  it("times the multi-limb cap only on the first batch past 2^64, then once", () => {
    const device = fakeDevice();
    const calibrator = new SieveCalibrator(device.sieve, null, device.now);
    calibrator.capFor(2n ** 63n);
    assert.ok(device.batches.every(({ from }) => from < 2n ** 64n));
    const decision = calibrator.capFor(2n ** 64n);
    assert.ok(decision.agreed && decision.cap === BEST_MULTI_LIMB_CAP && decision.setupMs > 0);
    const batchesTimed = device.batches.length;
    assert.deepEqual(calibrator.capFor(10n ** 24n), { agreed: true, cap: BEST_MULTI_LIMB_CAP, setupMs: 0 });
    assert.equal(device.batches.length, batchesTimed);
  });

  it("switches at the first rung if the full sieve's base primes can't be built", () => {
    const device = fakeDevice({ extends: false });
    const calibrator = new SieveCalibrator(device.sieve, null, device.now);
    const decision = calibrator.capFor(2n ** 36n);
    assert.ok(decision.agreed && decision.cap === BEST_CAP);
    assert.equal(device.builds.length, 1, "one failed build, not repeated");
  });

  it("treats a budget too small for the full sieve like a failed build, building nothing", () => {
    const device = fakeDevice();
    const decision = new SieveCalibrator(device.sieve, 1, device.now).capFor(2n ** 36n);
    assert.ok(decision.agreed && decision.cap === BEST_CAP);
    assert.deepEqual(device.builds, []);
  });

  it("reports where the methods disagree, and decides nothing from it", () => {
    const device = fakeDevice({ differAt: 2n ** 40n });
    assert.deepEqual(new SieveCalibrator(device.sieve, null, device.now).capFor(2n ** 63n), {
      agreed: false,
      from: 2n ** 40n,
    });
  });

  it("reports a disagreement while timing the multi-limb cap", () => {
    const device = fakeDevice({ differAt: 2n ** 66n, differingCap: 2n ** 16n });
    const decision = new SieveCalibrator(device.sieve, null, device.now).capFor(2n ** 64n);
    assert.equal(decision.agreed, false);
  });

  it("starts from the provisional cap", () => {
    const device = fakeDevice();
    new SieveCalibrator(device.sieve, null, device.now).capFor(2n ** 36n);
    assert.ok(device.batches.some(({ cap }) => cap === PARTIAL_SIEVE_PRIME_CAP));
  });
});

describe("buildBasePrimes", () => {
  it("reserves within the budget, and reports whether they fit", () => {
    const reserved: number[] = [];
    const sieve = { reserveBasePrimeStorage: (bytes: number) => (reserved.push(bytes), true), extendBasePrimes: () => false };
    assert.equal(buildBasePrimes(sieve as unknown as Sieve, 10n ** 8n, 1000), false);
    assert.deepEqual(reserved, [1000]);
  });
});
