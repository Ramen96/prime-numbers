import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  estimatePrimeOrdinal,
  logarithmicIntegral,
  logarithmicIntegralOfHugeNumber,
  naturalLog,
} from "./logarithmicIntegral.ts";

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

describe("with BigInt inputs", () => {
  it("gives the same li as a number input", () => {
    assert.equal(logarithmicIntegral(1_000_000_000_000n), logarithmicIntegral(1e12));
    assertClose(logarithmicIntegral(10n ** 12n), 37_607_950_280.8);
  });

  it("works past 2^53, where a number can't hold every integer", () => {
    // The largest prime below 2^64. π(2^64) = 425,656,284,035,217,743, itself past 2^53.
    const primeCountBelow2To64 = 425_656_284_035_217_743n;
    const estimate = estimatePrimeOrdinal(18_446_744_073_709_551_557n);
    assert.equal(typeof estimate, "bigint");
    assert.ok(estimate > 2n ** 53n);
    const relativeError = Number(estimate - primeCountBelow2To64) / Number(primeCountBelow2To64);
    assert.ok(relativeError > 0 && relativeError < 1e-6, `got ${estimate}`); // li overestimates slightly
  });

  it("reads ln(x) from the digits when x is far past 10^308", () => {
    assert.ok(Math.abs(naturalLog(10n ** 400n) - 400 * Math.LN10) < 1e-9);
    assert.ok(Math.abs(naturalLog(3n * 10n ** 500n) - (Math.log(3) + 500 * Math.LN10)) < 1e-9);
  });

  it("the large-number method agrees with Ramanujan's series where both work (10^300)", () => {
    const fromSeries = logarithmicIntegral(10n ** 300n - 1n);
    const fromAsymptoticExpansion = Number(logarithmicIntegralOfHugeNumber(10n ** 300n));
    assert.ok(Math.abs(fromAsymptoticExpansion / fromSeries - 1) < 1e-9);
  });

  it("estimates li(10^400), far above 10^308, to the expected size and leading digits", () => {
    const estimate = estimatePrimeOrdinal(10n ** 400n);
    // li(x) ≈ x / ln x · (1 + 1/ln x + 2/(ln x)^2 + …), with ln x ≈ 921.03
    const lnX = 400 * Math.LN10;
    const expectedLeadingFactor = (1 / lnX) * (1 + 1 / lnX + 2 / lnX ** 2 + 6 / lnX ** 3);
    assert.equal(estimate.toString().length, 398); // ≈ 1.087 × 10^397
    const ratio = Number((estimate * 10n ** 20n) / 10n ** 400n) / 1e20;
    assert.ok(Math.abs(ratio / expectedLeadingFactor - 1) < 1e-10, `ratio ${ratio}`);
  });
});

describe("estimatePrimeOrdinal", () => {
  it("rounds li to the nearest integer, as a BigInt", () => {
    assert.equal(estimatePrimeOrdinal(1_000_000_000_000n), 37_607_950_281n);
  });
});
