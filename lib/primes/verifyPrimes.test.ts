import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPrime as referenceIsPrime } from "../../tests/support/primality.ts";
import { DETERMINISTIC_VERIFICATION_LIMIT, millerRabinVerdict, verifyPrimes } from "./verifyPrimes.ts";

describe("millerRabinVerdict", () => {
  it("catches every strong pseudoprime from OEIS A014233", () => {
    // Each passes Miller–Rabin with the first k prime bases; the verifier must
    // use enough bases to expose it. Source: https://oeis.org/A014233/b014233.txt
    for (const pseudoprime of [
      2047n, 1_373_653n, 25_326_001n, 3_215_031_751n, 2_152_302_898_747n, 3_474_749_660_383n,
      341_550_071_728_321n, 3_825_123_056_546_413_051n, 318_665_857_834_031_151_167_461n,
    ]) {
      assert.equal(millerRabinVerdict(pseudoprime), "composite", `${pseudoprime}`);
    }
  });

  it("agrees with the test reference (all 13 bases, every time) across sizes", () => {
    for (const start of [0n, 2040n, 1_373_600n, 25_326_000n, 3_215_031_700n, 2n ** 53n, 2n ** 63n, 2n ** 64n, 10n ** 23n]) {
      for (let candidate = start; candidate < start + 400n; candidate++) {
        assert.equal(millerRabinVerdict(candidate) === "prime", referenceIsPrime(candidate), `${candidate}`);
      }
    }
  });

  it("refuses to answer past the proven bound instead of guessing", () => {
    const smallPrimes = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n];
    let withoutSmallFactor = DETERMINISTIC_VERIFICATION_LIMIT + 1n;
    while (smallPrimes.some((prime) => withoutSmallFactor % prime === 0n)) withoutSmallFactor++;
    assert.equal(millerRabinVerdict(withoutSmallFactor), "beyond-proven-bound");
    // A small factor is proof at any size.
    assert.equal(millerRabinVerdict(DETERMINISTIC_VERIFICATION_LIMIT * 7n), "composite");
  });
});

describe("verifyPrimes", () => {
  it("accepts a batch of primes", () => {
    assert.deepEqual(verifyPrimes([2n, 3n, 5n, 1_000_003n, 2n ** 61n - 1n]), { verified: true });
  });

  it("names the first number that isn't proven prime", () => {
    assert.deepEqual(verifyPrimes([7n, 11n, 2047n, 13n, 15n]), {
      verified: false,
      disputedPrime: 2047n,
      verdict: "composite",
    });
  });
});
