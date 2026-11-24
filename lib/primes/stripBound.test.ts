import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StripReport } from "./proofSlots.ts";
import { StripBound, STRIP_DEPTHS } from "./stripBound.ts";

const report = (limbs: number, waitedShare: number): StripReport => ({
  orderCount: 40,
  limbs,
  largestPrime: 0,
  stripMs: 100,
  waitedMs: 100 * waitedShare,
});

describe("StripBound", () => {
  it("starts at the CPU's own bound: 10^5 below 26 limbs (832 bits), 10^6 from there", () => {
    const bound = new StripBound();
    assert.equal(bound.largestPrimeFor(11), 100_000);
    assert.equal(bound.largestPrimeFor(25), 100_000);
    assert.equal(bound.largestPrimeFor(26), 1_000_000);
    assert.equal(bound.largestPrimeFor(104), 1_000_000);
  });

  it("goes one step deeper after each call the provers hardly waited for, up to 10^8", () => {
    const bound = new StripBound();
    const seen: number[] = [];
    for (let call = 0; call < 10; call++) {
      seen.push(bound.largestPrimeFor(11));
      bound.record(report(11, 0.01));
    }
    assert.deepEqual(seen, [...STRIP_DEPTHS, 100_000_000, 100_000_000, 100_000_000]);
  });

  it("goes one step shallower when they waited a good part of it, never below the start; stays in between", () => {
    const bound = new StripBound();
    for (let call = 0; call < 4; call++) bound.record(report(30, 0)); // 10^6 → 10^8
    assert.equal(bound.largestPrimeFor(30), 100_000_000);
    bound.record(report(30, 0.1));
    assert.equal(bound.largestPrimeFor(30), 100_000_000, "in between: the same");
    bound.record(report(30, 0.5));
    assert.equal(bound.largestPrimeFor(30), 31_622_777);
    for (let call = 0; call < 10; call++) bound.record(report(30, 0.9));
    assert.equal(bound.largestPrimeFor(30), 1_000_000, "never shallower than the CPU's own bound");
  });

  it("keeps each size of order apart", () => {
    const bound = new StripBound();
    bound.record(report(11, 0));
    bound.record(report(11, 0));
    assert.equal(bound.largestPrimeFor(11), 1_000_000);
    assert.equal(bound.largestPrimeFor(12), 100_000);
  });
});
