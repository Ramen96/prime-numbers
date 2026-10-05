import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimatePrimeOrdinal, logarithmicIntegral } from "./logarithmicIntegral.ts";

/** Reference values are given to one decimal place, so allow for that rounding. */
const TOLERANCE = 0.1;

function assertClose(actual: number, expected: number) {
  assert.ok(
    Math.abs(actual - expected) <= TOLERANCE,
    `expected ${expected} ± ${TOLERANCE}, got ${actual}`,
  );
}

describe("logarithmicIntegral", () => {
  it("matches li(10^6) ≈ 78,627.5 (real prime count: 78,498)", () => {
    assertClose(logarithmicIntegral(1e6), 78_627.5);
  });

  it("matches li(10^9) ≈ 50,849,234.9 (real prime count: 50,847,534)", () => {
    assertClose(logarithmicIntegral(1e9), 50_849_234.9);
  });

  it("matches li(10^12) ≈ 37,607,950,280.8 (real prime count: 37,607,912,018)", () => {
    assertClose(logarithmicIntegral(1e12), 37_607_950_280.8);
  });

  it("is far more accurate than x / ln x", () => {
    const realPrimeCount = 37_607_912_018;
    const liError = Math.abs(logarithmicIntegral(1e12) - realPrimeCount);
    const xOverLnXError = Math.abs(1e12 / Math.log(1e12) - realPrimeCount);
    assert.ok(liError * 1000 < xOverLnXError);
  });

  it("stays finite near the top of the safe integer range", () => {
    assert.ok(Number.isFinite(logarithmicIntegral(Number.MAX_SAFE_INTEGER - 1)));
  });

  it("rejects x ≤ 1, where li is undefined or not useful", () => {
    assert.throws(() => logarithmicIntegral(1), RangeError);
    assert.throws(() => logarithmicIntegral(0), RangeError);
  });
});

describe("estimatePrimeOrdinal", () => {
  it("rounds li to the nearest integer", () => {
    assert.equal(estimatePrimeOrdinal(1e12), 37_607_950_281);
  });
});
