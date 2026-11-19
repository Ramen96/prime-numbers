import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GIVE_UP_RATE, heatFromRate, MELTDOWN_FULL_RATE, meltdownFromRate, primesTakeMinutes } from "./heat.ts";

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

describe("heatFromRate", () => {
  it("goes from cool at 10^7 primes/s to hot at 10^5, on a log scale", () => {
    close(heatFromRate(1e8), 0);
    close(heatFromRate(1e7), 0);
    close(heatFromRate(1e6), 0.5);
    close(heatFromRate(1e5), 1);
    close(heatFromRate(1), 1);
  });

  it("is cool without a rate", () => {
    for (const rate of [0, -1, Number.NaN]) close(heatFromRate(rate), 0);
  });
});

describe("meltdownFromRate", () => {
  it("starts exactly where heat reaches its top, and is complete at one prime every ten minutes", () => {
    close(meltdownFromRate(1e6), 0);
    close(meltdownFromRate(1e5), 0);
    close(heatFromRate(1e5), 1);
    close(meltdownFromRate(MELTDOWN_FULL_RATE), 1);
    close(meltdownFromRate(1 / 3600), 1);
  });

  it("spreads across the sizes proofs cover (laptop rates)", () => {
    // 10^60 about 50 primes/s, 10^100 about 9, 300 digits about 1
    assert.ok(meltdownFromRate(50) > 0.4 && meltdownFromRate(50) < 0.45);
    assert.ok(meltdownFromRate(9) > 0.5 && meltdownFromRate(9) < 0.55);
    assert.ok(meltdownFromRate(1) > 0.6 && meltdownFromRate(1) < 0.67);
  });

  it("is 0 without a rate", () => {
    for (const rate of [0, -1, Number.NaN]) close(meltdownFromRate(rate), 0);
  });
});

describe("primesTakeMinutes", () => {
  it("is true from one prime a minute down, and not a moment before", () => {
    assert.equal(primesTakeMinutes(1 / 59), false);
    assert.equal(primesTakeMinutes(GIVE_UP_RATE), true);
    assert.equal(primesTakeMinutes(1 / 600), true);
    assert.equal(primesTakeMinutes(1e5), false);
  });

  it("comes after the × eyes (meltdown 0.75)", () => {
    assert.ok(meltdownFromRate(GIVE_UP_RATE) > 0.75);
  });

  it("is false without a rate", () => {
    for (const rate of [0, -1, Number.NaN]) assert.equal(primesTakeMinutes(rate), false);
  });
});
