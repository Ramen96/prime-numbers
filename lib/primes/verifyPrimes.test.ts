import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPrime as referenceIsPrime } from "../../tests/support/primality.ts";
import {
  compositeEvidenceHolds,
  DETERMINISTIC_VERIFICATION_LIMIT,
  millerRabinVerdict,
  verifyBatch,
  verifyPrimes,
} from "./verifyPrimes.ts";

const EVIDENCE_BASES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41];

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

describe("compositeEvidenceHolds (re-checking the sieve's rejected composites)", () => {
  it("accepts a small prime that divides the candidate", () => {
    assert.equal(compositeEvidenceHolds(15n, 3), true);
    assert.equal(compositeEvidenceHolds(15n, 5), true);
    assert.equal(compositeEvidenceHolds(3n * (2n ** 64n + 13n), 3), true); // at any size
  });

  it("accepts a Miller–Rabin witness, and not a base the composite fools", () => {
    // 2047 = 23 × 89 is a strong pseudoprime to base 2, but base 3 is a witness
    assert.equal(compositeEvidenceHolds(2047n, 2), false);
    assert.equal(compositeEvidenceHolds(2047n, 3), true);
    // a product of two primes near 2^40: no small factor, so only a witness can prove it
    const semiprime = 1_000_000_000_039n * 1_000_000_000_061n;
    const witnesses = EVIDENCE_BASES.filter((base) => compositeEvidenceHolds(semiprime, base));
    assert.ok(witnesses.length > 0);
  });

  it("never holds for a prime, whatever the evidence: a prime rejected by mistake is always caught", () => {
    const primes = [
      43n, 1_000_003n, 4_294_967_311n, 2n ** 61n - 1n, 2n ** 64n - 59n, 2n ** 64n + 13n,
      100_000_000_000_000_000_039n, 1_000_000_000_000_000_000_000_007n,
    ];
    for (const prime of primes) {
      for (const evidence of [0, 1, ...EVIDENCE_BASES, 43, 2 ** 32 - 1]) {
        assert.equal(compositeEvidenceHolds(prime, evidence), false, `${prime} with evidence ${evidence}`);
      }
    }
  });

  it("doesn't accept 1, 0 or the candidate itself as a factor", () => {
    assert.equal(compositeEvidenceHolds(9n, 1), false);
    assert.equal(compositeEvidenceHolds(9n, 0), false);
    assert.equal(compositeEvidenceHolds(41n, 41), false);
  });
});

describe("verifyBatch", () => {
  it("accepts proven primes and proven composites", () => {
    assert.deepEqual(
      verifyBatch([1_000_003n], [{ candidate: 2047n, evidence: 3 }, { candidate: 1_000_005n, evidence: 5 }]),
      { verified: true },
    );
  });

  it("names the first rejected composite whose evidence doesn't hold", () => {
    assert.deepEqual(verifyBatch([1_000_003n], [{ candidate: 2047n, evidence: 3 }, { candidate: 1_000_033n, evidence: 7 }]), {
      verified: false,
      disputedComposite: 1_000_033n,
      evidence: 7,
    });
  });

  it("checks the primes first", () => {
    assert.deepEqual(verifyBatch([2047n], [{ candidate: 1_000_033n, evidence: 7 }]), {
      verified: false,
      disputedPrime: 2047n,
      verdict: "composite",
    });
  });
});
