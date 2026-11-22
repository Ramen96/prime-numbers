import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certifiedPrimeFrom } from "../tests/support/curveCertificates.ts";
import {
  answerHolds,
  describeAnswer,
  exactSquareRoot,
  parseNumberToCheck,
  proofBelowProvenBound,
  SMALL_FACTOR_LIMIT,
  smallestSmallFactor,
  type PrimeCheckAnswer,
} from "./primeCheck.ts";
import { primalityTableBelow } from "./primes/sieveOfEratosthenes.ts";
import { DETERMINISTIC_VERIFICATION_LIMIT } from "./primes/verifyPrimes.ts";

/** The reference: plain trial division, one prime at a time. */
function smallestSmallFactorByTrialDivision(value: bigint): bigint | null {
  for (let divisor = 2n; divisor < BigInt(SMALL_FACTOR_LIMIT) && divisor < value; divisor++)
    if (value % divisor === 0n) return divisor;
  return null;
}

/** A repeatable pseudo-random BigInt with `bits` bits (xorshift, seeded). */
function randomBigInts(seed: number) {
  let state = BigInt(seed) | 1n;
  const next64 = () => {
    state ^= (state << 13n) & 0xffff_ffff_ffff_ffffn;
    state ^= state >> 7n;
    state ^= (state << 17n) & 0xffff_ffff_ffff_ffffn;
    return state;
  };
  return (bits: number) => {
    let value = 0n;
    for (let filled = 0; filled < bits; filled += 64) value = (value << 64n) | next64();
    return (value & ((1n << BigInt(bits)) - 1n)) | (1n << BigInt(bits - 1));
  };
}

describe("smallestSmallFactor", () => {
  it("agrees with plain trial division for every number below 20,000", () => {
    for (let value = 0n; value < 20_000n; value++)
      assert.equal(smallestSmallFactor(value), smallestSmallFactorByTrialDivision(value), String(value));
  });

  it("agrees with trial division on random numbers from 20 to 4,000 bits, and on products of two primes near the limit", () => {
    const random = randomBigInts(7);
    for (const bits of [20, 40, 64, 100, 200, 1000, 4000])
      for (let sample = 0; sample < 40; sample++) {
        const value = random(bits);
        assert.equal(smallestSmallFactor(value), smallestSmallFactorByTrialDivision(value), `${bits} bits`);
      }
    // the largest primes below 65,536 (65,521 and 65,519) and the first above it (65,537)
    assert.equal(smallestSmallFactor(65_521n * 65_537n), 65_521n);
    assert.equal(smallestSmallFactor(65_519n * 65_521n * (10n ** 50n + 151n)), 65_519n);
    assert.equal(smallestSmallFactor(65_537n * 65_539n), null, "both factors past the limit");
    assert.equal(smallestSmallFactor(65_521n), null, "a small prime isn't its own factor");
    assert.equal(smallestSmallFactor(1_000_001n), 101n);
  });

  it("finds a small factor of a number with a million digits in under a second", () => {
    // 10^999,999 ≡ (10^3)^333,333 ≡ (−1)^333,333 mod 7 (1,000 ≡ −1 mod 7), so 7 divides it, and 2, 3 and 5 don't
    const huge = 10n ** 999_999n + 1n;
    let started = performance.now();
    assert.equal(smallestSmallFactor(huge), 7n);
    // the slowest case, every group read: 1 more than a multiple of every prime below 65,536, so none divides it
    let everySmallPrime = 1n;
    const isPrime = primalityTableBelow(SMALL_FACTOR_LIMIT);
    for (let prime = 2; prime < SMALL_FACTOR_LIMIT; prime++) if (isPrime[prime]) everySmallPrime *= BigInt(prime);
    const noSmallFactor = everySmallPrime * 10n ** 972_000n + 1n; // the product has about 28,400 digits
    started = performance.now();
    assert.equal(smallestSmallFactor(noSmallFactor), null);
    assert.equal(smallestSmallFactor(noSmallFactor * 65_521n), 65_521n);
    assert.ok(performance.now() - started < 1_000, `${performance.now() - started} ms`);
  });
});

describe("exactSquareRoot", () => {
  it("finds roots of squares, and nothing for numbers next to them", () => {
    for (const root of [1n, 2n, 3n, 255n, 65_537n, 10n ** 40n + 7n]) {
      assert.equal(exactSquareRoot(root * root), root);
      if (root > 1n) assert.equal(exactSquareRoot(root * root - 1n), null);
      assert.equal(exactSquareRoot(root * root + 1n), null);
    }
    assert.equal(exactSquareRoot(0n), null);
  });
});

describe("answerHolds: the independent re-check", () => {
  const { prime: certifiedPrime, steps } = certifiedPrimeFrom(10n ** 40n);
  const holds = (answer: PrimeCheckAnswer) => answerHolds(answer);

  it("accepts true answers", () => {
    assert.ok(holds({ kind: "neither", value: 1n }));
    assert.ok(holds({ kind: "prime", value: 1_000_003n, proof: proofBelowProvenBound(1_000_003n) }));
    const bigPrime = 2n ** 61n - 1n; // a Mersenne prime past 65,536²
    assert.deepEqual(proofBelowProvenBound(bigPrime).by, "miller-rabin");
    assert.ok(holds({ kind: "prime", value: bigPrime, proof: proofBelowProvenBound(bigPrime) }));
    assert.ok(holds({ kind: "prime", value: certifiedPrime, proof: { by: "certificate", steps } }));
    assert.ok(holds({ kind: "probably-prime", value: certifiedPrime }));
    assert.ok(holds({ kind: "composite", value: 1_000_001n, evidence: { by: "factor", factor: 101n } }));
    assert.ok(holds({ kind: "composite", value: 65_537n * 65_539n, evidence: { by: "witness", base: 2 } }));
    assert.ok(holds({ kind: "composite", value: (10n ** 30n + 57n) ** 2n, evidence: { by: "square", root: 10n ** 30n + 57n } }));
  });

  it("refuses every false one", () => {
    assert.ok(!holds({ kind: "neither", value: 2n }));
    assert.ok(!holds({ kind: "prime", value: 1_000_001n, proof: proofBelowProvenBound(1_000_001n) }), "has a small factor");
    assert.ok(!holds({ kind: "prime", value: 65_537n * 65_539n, proof: { by: "trial-division" } }), "past 65,536², trial division to 65,536 proves nothing");
    assert.ok(!holds({ kind: "prime", value: 65_537n * 65_539n, proof: proofBelowProvenBound(65_537n * 65_539n) }));
    assert.ok(!holds({ kind: "prime", value: DETERMINISTIC_VERIFICATION_LIMIT, proof: { by: "miller-rabin", bases: [] } }), "a(13) passes the 13 bases");
    assert.ok(!holds({ kind: "prime", value: certifiedPrime + 2n, proof: { by: "certificate", steps } }), "someone else's certificate");
    const tampered = steps.map((step, index) => (index === 1 ? { ...step, pointY: step.pointY + 1n } : step));
    assert.ok(!holds({ kind: "prime", value: certifiedPrime, proof: { by: "certificate", steps: tampered } }));
    assert.ok(!holds({ kind: "probably-prime", value: 1_000_003n }), "below a(13) a probable prime is never the answer");
    assert.ok(!holds({ kind: "probably-prime", value: DETERMINISTIC_VERIFICATION_LIMIT * 3n }));
    assert.ok(!holds({ kind: "composite", value: 1_000_003n, evidence: { by: "factor", factor: 101n } }));
    assert.ok(!holds({ kind: "composite", value: 1_000_003n, evidence: { by: "factor", factor: 1_000_003n } }));
    assert.ok(!holds({ kind: "composite", value: 1_000_003n, evidence: { by: "witness", base: 2 } }));
    assert.ok(!holds({ kind: "composite", value: 1_000_003n, evidence: { by: "square", root: 1000n } }));
    assert.ok(!holds({ kind: "composite", value: certifiedPrime, evidence: { by: "lucas" } }));
  });
});

describe("describeAnswer", () => {
  const text = (answer: PrimeCheckAnswer) => describeAnswer(answer);

  it("says what each answer means", () => {
    assert.equal(text({ kind: "neither", value: 0n }).headline, "0 isn’t prime.");
    assert.equal(text({ kind: "neither", value: 1n }).headline, "1 isn’t prime.");
    assert.equal(text({ kind: "prime", value: 2n, proof: { by: "trial-division" } }).explanation, "Its only divisors are 1 and 2. It’s the only even prime.");
    assert.deepEqual(text({ kind: "prime", value: 1_000_003n, proof: proofBelowProvenBound(1_000_003n) }), {
      headline: "1,000,003 is prime.",
      explanation: "None of the primes up to 1,000 divides it, and every composite number has a prime factor no larger than its square root.",
    });
    assert.equal(
      text({ kind: "prime", value: 2n ** 61n - 1n, proof: proofBelowProvenBound(2n ** 61n - 1n) }).explanation,
      "Proven by Miller–Rabin with the first 9 primes as bases (2 to 23). For a number this size that’s a proof, not a probability: the smallest composite that passes all of them is known (OEIS A014233), and 2,305,843,009,213,693,951 is below it.",
    );
    assert.deepEqual(text({ kind: "composite", value: 1_000_001n, evidence: { by: "factor", factor: 101n } }), {
      headline: "1,000,001 isn’t prime: it’s divisible by 101.",
      explanation: "1,000,001 = 101 × 9,901.",
    });
    assert.equal(text({ kind: "composite", value: 1_000_000n, evidence: { by: "factor", factor: 2n } }).headline, "1,000,000 isn’t prime: it’s even.");
    assert.equal(text({ kind: "composite", value: 4_295_098_369n, evidence: { by: "square", root: 65_537n } }).headline, "4,295,098,369 isn’t prime: it’s 65,537².");
    assert.match(text({ kind: "composite", value: 4_295_229_443n, evidence: { by: "witness", base: 2 } }).explanation, /no factor below 65,536/);
    assert.equal(text({ kind: "probably-prime", value: 10n ** 20n + 39n }).headline, "100,000,000,000,000,000,039 is almost certainly prime.");
    assert.match(text({ kind: "probably-prime", value: 10n ** 30n + 57n }).explanation, /isn’t a proof yet/);
  });

  it("shortens a long number in the middle", () => {
    assert.equal(text({ kind: "composite", value: 10n ** 100n, evidence: { by: "factor", factor: 2n } }).headline.includes(",…,"), true);
  });
});

describe("parseNumberToCheck", () => {
  it("reads as the jump box does, with its own message for an empty box", () => {
    assert.deepEqual(parseNumberToCheck("1,000,003"), { valid: true, target: 1_000_003n });
    assert.deepEqual(parseNumberToCheck("0"), { valid: true, target: 0n });
    assert.deepEqual(parseNumberToCheck("  "), { valid: false, message: "Type a number to check." });
    assert.deepEqual(parseNumberToCheck("2.5"), { valid: false, message: "Whole numbers only. Primes don’t do fractions." });
  });
});
