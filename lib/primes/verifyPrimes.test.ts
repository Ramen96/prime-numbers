import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certifiedPrimeFrom } from "../../tests/support/curveCertificates.ts";
import { isPrime as referenceIsPrime } from "../../tests/support/primality.ts";
import {
  compositeEvidenceHolds,
  DETERMINISTIC_VERIFICATION_LIMIT,
  failsStrongLucas,
  millerRabinVerdict,
  rejectionHolds,
  verifyBatch,
  verifyPrimes,
  verifyRejectedComposites,
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

describe("verifyPrimes from a(13) up (certificates)", () => {
  const justPastBound = certifiedPrimeFrom(DETERMINISTIC_VERIFICATION_LIMIT);
  const thirtyDigits = certifiedPrimeFrom(10n ** 30n);
  const bothCertificates = new Map([
    [justPastBound.prime, justPastBound.steps],
    [thirtyDigits.prime, thirtyDigits.steps],
  ]);

  it("accepts primes past a(13) whose certificates hold, alongside primes below it", () => {
    assert.deepEqual(verifyPrimes([1_000_003n, justPastBound.prime, thirtyDigits.prime], bothCertificates), { verified: true });
    assert.deepEqual(verifyBatch([justPastBound.prime], [], bothCertificates), { verified: true });
  });

  it("refuses a prime past a(13) with no certificate", () => {
    assert.deepEqual(verifyPrimes([justPastBound.prime, thirtyDigits.prime], new Map([[justPastBound.prime, justPastBound.steps]])), {
      verified: false,
      disputedPrime: thirtyDigits.prime,
      verdict: "beyond-proven-bound",
    });
  });

  it("refuses a certificate with one value changed", () => {
    const [first, ...rest] = thirtyDigits.steps;
    const tampered = [{ ...first, pointY: first.pointY + 1n }, ...rest];
    const verification = verifyPrimes([thirtyDigits.prime], new Map([[thirtyDigits.prime, tampered]]));
    assert.equal(verification.verified, false);
    assert.equal("verdict" in verification && verification.verdict, "certificate-invalid");
    assert.equal("disputedPrime" in verification && verification.disputedPrime, thirtyDigits.prime);
  });

  it("refuses another prime's certificate", () => {
    assert.deepEqual(verifyPrimes([thirtyDigits.prime], new Map([[thirtyDigits.prime, justPastBound.steps]])), {
      verified: false,
      disputedPrime: thirtyDigits.prime,
      verdict: "certificate-invalid",
      reason: `the chain is broken (at ${justPastBound.prime})`,
    });
  });

  it("refuses a chain that stops past a(13), where Miller–Rabin proves nothing", () => {
    const shortened = thirtyDigits.steps.slice(0, -1);
    assert.deepEqual(verifyPrimes([thirtyDigits.prime], new Map([[thirtyDigits.prime, shortened]])), {
      verified: false,
      disputedPrime: thirtyDigits.prime,
      verdict: "certificate-invalid",
      reason: `the chain doesn't end at a number proven prime (at ${shortened.at(-1)!.orderPrime})`,
    });
    assert.deepEqual(verifyPrimes([thirtyDigits.prime], new Map([[thirtyDigits.prime, []]])), {
      verified: false,
      disputedPrime: thirtyDigits.prime,
      verdict: "certificate-invalid",
      reason: "the chain doesn't end at a number proven prime",
    });
  });

  it("still finds a composite with a small factor composite, certificate or not", () => {
    const composite = thirtyDigits.prime * 7n;
    assert.deepEqual(verifyPrimes([composite], new Map([[composite, thirtyDigits.steps]])), {
      verified: false,
      disputedPrime: composite,
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
      verifyBatch([1_000_003n], [{ candidate: 2047n, evidence: 3, kind: "evidence" }, { candidate: 1_000_005n, evidence: 5, kind: "evidence" }]),
      { verified: true },
    );
  });

  it("names the first rejected composite whose evidence doesn't hold", () => {
    assert.deepEqual(verifyBatch([1_000_003n], [{ candidate: 2047n, evidence: 3, kind: "evidence" }, { candidate: 1_000_033n, evidence: 7, kind: "evidence" }]), {
      verified: false,
      disputedComposite: 1_000_033n,
      evidence: 7,
      kind: "evidence",
    });
  });

  it("checks the primes first", () => {
    assert.deepEqual(verifyBatch([2047n], [{ candidate: 1_000_033n, evidence: 7, kind: "evidence" }]), {
      verified: false,
      disputedPrime: 2047n,
      verdict: "composite",
    });
  });
});

describe("rejectionHolds (each kind of rejection, checked again)", () => {
  const A13 = 3_317_044_064_679_887_385_961_981n; // passes the first 13 Miller–Rabin bases; Lucas throws it out

  it("holds for BPSW's Lucas and square verdicts on composites, with no number as evidence", () => {
    assert.equal(rejectionHolds({ candidate: A13, evidence: 0, kind: "lucas" }), true);
    assert.equal(rejectionHolds({ candidate: 1093n * 1093n, evidence: 0, kind: "square" }), true); // passes base 2
    assert.equal(rejectionHolds({ candidate: 2047n, evidence: 3, kind: "evidence" }), true);
  });

  it("never holds for a prime, whatever the kind: a prime rejected by mistake is always caught", () => {
    for (const prime of [nextPrime(A13), 2n ** 127n - 1n, 1_000_003n]) {
      for (const kind of ["evidence", "square", "lucas", "unknown"] as const) {
        assert.equal(rejectionHolds({ candidate: prime, evidence: 3, kind }), false, `${prime} as ${kind}`);
      }
    }
  });

  it("never holds for an unknown kind, even on a composite", () => {
    assert.equal(rejectionHolds({ candidate: A13, evidence: 0, kind: "unknown" }), false);
    assert.equal(rejectionHolds({ candidate: 15n, evidence: 3, kind: "unknown" }), false);
  });

  it("names the kind when one doesn't hold", () => {
    const prime = nextPrime(A13);
    assert.deepEqual(verifyRejectedComposites([{ candidate: A13, evidence: 0, kind: "lucas" }, { candidate: prime, evidence: 0, kind: "lucas" }]), {
      verified: false,
      disputedComposite: prime,
      evidence: 0,
      kind: "lucas",
    });
  });
});

/** The next prime after n, by the independent reference in tests/support. */
function nextPrime(n: bigint): bigint {
  for (let candidate = n + 1n; ; candidate++) if (referenceIsPrime(candidate)) return candidate;
}

describe("failsStrongLucas (re-checking BPSW's Lucas and square verdicts)", () => {
  it("passes exactly the primes and the 16 published strong Lucas pseudoprimes below 130,140 (OEIS A217255)", () => {
    const published = [
      5459n, 5777n, 10877n, 16109n, 18971n, 22499n, 24569n, 25199n, 40309n, 58519n, 75077n, 97439n, 100127n, 113573n,
      115639n, 130139n,
    ];
    const found: bigint[] = [];
    for (let candidate = 43n; candidate < 130_140n; candidate += 2n) {
      const isPrime = referenceIsPrime(candidate);
      if (isPrime) assert.equal(failsStrongLucas(candidate), false, `${candidate} is prime`);
      else if (!failsStrongLucas(candidate)) found.push(candidate);
    }
    assert.deepEqual(found, published);
  });

  it("never fails a large prime, and catches squares", () => {
    for (const prime of [2n ** 89n - 1n, 2n ** 521n - 1n, 10n ** 100n + 267n]) {
      assert.equal(failsStrongLucas(prime), false, `${prime}`);
      assert.equal(failsStrongLucas(prime * prime), true, `${prime}²`);
    }
  });
});
