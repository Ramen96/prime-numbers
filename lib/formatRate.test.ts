import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeRate, formatDuration } from "./formatRate.ts";

describe("describeRate", () => {
  it("is a rate from one prime per second up", () => {
    assert.deepEqual(describeRate(1_234_567.4), { value: "1,234,567", unit: "primes per second" });
    assert.deepEqual(describeRate(1), { value: "1", unit: "primes per second" });
  });

  it("is the time per prime below that, never a rate of 0", () => {
    assert.deepEqual(describeRate(0.5), { value: "2.0 s", unit: "per prime" });
    assert.deepEqual(describeRate(1 / 42), { value: "42 s", unit: "per prime" });
    assert.deepEqual(describeRate(1 / 210), { value: "3.5 min", unit: "per prime" });
  });
});

describe("formatDuration", () => {
  it("uses the largest unit the duration fills", () => {
    assert.equal(formatDuration(59), "59 s");
    assert.equal(formatDuration(60), "1.0 min");
    assert.equal(formatDuration(3_600 * 17), "17 h");
    assert.equal(formatDuration(86_400 * 3.25), "3.3 days");
  });

  it("has one decimal below 10 and none from 10, even when rounding up to 10", () => {
    assert.equal(formatDuration(1.44), "1.4 s");
    assert.equal(formatDuration(9.96), "10 s");
    assert.equal(formatDuration(10.4), "10 s");
  });

  it("keeps going for any length of time: days have no upper limit", () => {
    assert.equal(formatDuration(86_400 * 12_345), "12,345 days");
  });
});
