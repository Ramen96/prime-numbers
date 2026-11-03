import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certifiedPrimeFrom } from "../../tests/support/curveCertificates.ts";
import { addPoints, checkCertificate, orderIsLargeEnough, type CertificateStep } from "./primalityCertificate.ts";
import { DETERMINISTIC_VERIFICATION_LIMIT } from "./verifyPrimes.ts";

const { prime: PRIME_30_DIGITS, steps: STEPS_30_DIGITS } = certifiedPrimeFrom(10n ** 30n);
const STEP = STEPS_30_DIGITS[0];
const reason = (candidate: bigint, steps: readonly CertificateStep[]) => {
  const check = checkCertificate(candidate, steps);
  return check.valid ? "valid" : check.reason;
};
/** The certificate with one field of its first step changed. */
const withFirstStep = (change: Partial<CertificateStep>) => [{ ...STEP, ...change }, ...STEPS_30_DIGITS.slice(1)];

describe("checkCertificate accepts real proofs", () => {
  it("of primes past a(13), at growing sizes", () => {
    for (const start of [10n ** 25n, 10n ** 30n, 10n ** 40n, 10n ** 60n, 10n ** 100n]) {
      const { prime, steps } = certifiedPrimeFrom(start);
      assert.ok(prime > DETERMINISTIC_VERIFICATION_LIMIT);
      assert.ok(steps.length > 0);
      assert.deepEqual(checkCertificate(prime, steps), { valid: true }, `${prime}`);
    }
  });

  it("with no steps, below a(13), by deterministic Miller–Rabin", () => {
    assert.deepEqual(checkCertificate(1_000_003n, []), { valid: true });
  });
});

describe("checkCertificate refuses", () => {
  it("anything past a(13) with no proof at all", () => {
    assert.match(reason(2n ** 89n - 1n, []), /doesn't end/);
  });

  it("a composite, even with no steps, below a(13)", () => {
    assert.match(reason(1_000_001n, []), /doesn't end/);
  });

  it("a certificate for a different number", () => {
    assert.match(reason(PRIME_30_DIGITS + 2n, STEPS_30_DIGITS), /chain is broken/);
  });

  it("a broken link in the chain", () => {
    const { prime, steps } = certifiedPrimeFrom(10n ** 100n);
    assert.ok(steps.length > 2);
    assert.match(reason(prime, [steps[0], ...steps.slice(2)]), /chain is broken/);
    assert.match(reason(PRIME_30_DIGITS, [{ ...STEP, number: STEP.number + 2n }]), /chain is broken/);
  });

  it("a chain that stops early, at a number past a(13) or not prime", () => {
    assert.match(reason(PRIME_30_DIGITS, [{ ...STEP, orderPrime: DETERMINISTIC_VERIFICATION_LIMIT + 6n }]), /order/);
    const last = STEPS_30_DIGITS.at(-1)!;
    const chain = STEPS_30_DIGITS.slice(0, -1);
    assert.deepEqual(checkCertificate(PRIME_30_DIGITS, [...chain, last]), { valid: true });
  });

  it("a point that isn't on the curve", () => {
    assert.match(reason(PRIME_30_DIGITS, withFirstStep({ pointY: (STEP.pointY + 1n) % STEP.number })), /on the curve/);
    assert.match(reason(PRIME_30_DIGITS, withFirstStep({ curveB: 1n })), /on the curve/);
  });

  it("a point that doesn't have the claimed order", () => {
    assert.match(reason(PRIME_30_DIGITS, withFirstStep({ orderPrime: STEP.orderPrime + 2n })), /order/);
    // 3q·Q really is the identity, but 3q is composite: the chain is what refuses it
    assert.equal(checkCertificate(PRIME_30_DIGITS, [{ ...STEP, orderPrime: STEP.orderPrime * 3n }]).valid, false);
  });

  it("an order too small to prove anything", () => {
    assert.match(reason(PRIME_30_DIGITS, withFirstStep({ orderPrime: 1009n })), /too small/);
  });

  it("a singular curve", () => {
    // y² = x³: the discriminant is 0, and (1, 1) is on it
    assert.match(reason(PRIME_30_DIGITS, withFirstStep({ curveA: 0n, curveB: 0n, pointX: 1n, pointY: 1n })), /singular/);
  });

  it("numbers sharing a factor with 6", () => {
    for (const number of [2n ** 90n, 3n ** 60n]) {
      assert.match(reason(number, [{ ...STEP, number }]), /factor with 6/);
    }
  });

  it("values outside the number's range", () => {
    assert.match(reason(PRIME_30_DIGITS, withFirstStep({ pointX: STEP.pointX + STEP.number })), /out of range/);
    assert.match(reason(PRIME_30_DIGITS, withFirstStep({ curveA: -1n })), /out of range/);
  });

  it("a composite number passing itself off with a real curve point", () => {
    // N = p · r, with a curve and point built to hold modulo p only: not on the
    // curve modulo r, or undefined along the way, whichever comes first.
    const composite = STEP.number * 1_000_003n;
    const forged = { ...STEP, number: composite };
    assert.equal(checkCertificate(composite, [forged, ...STEPS_30_DIGITS.slice(1)]).valid, false);
  });

  it("a composite orderPrime further down the chain", () => {
    const composite = 1_000_003n * 1_000_033n * 1_000_037n * 1_000_039n * 1_000_081n;
    assert.equal(checkCertificate(PRIME_30_DIGITS, [{ ...STEP, orderPrime: composite }]).valid, false);
  });
});

describe("addPoints", () => {
  // y² = x³ + 2x + 3 mod 97: (3, 6) is on it, and doubles to (80, 10), plus itself again (80, 87)
  it("adds and doubles on a known curve", () => {
    const point = { x: 3n, y: 6n };
    assert.deepEqual(addPoints(point, point, 2n, 97n), { x: 80n, y: 10n });
    assert.deepEqual(addPoints({ x: 80n, y: 10n }, point, 2n, 97n), { x: 80n, y: 87n });
  });

  it("gives the identity for a point and its negative", () => {
    assert.equal(addPoints({ x: 3n, y: 6n }, { x: 3n, y: 91n }, 2n, 97n), "identity");
  });

  it("refuses points alike modulo one factor only: same x, but y neither equal nor opposite", () => {
    // mod 35: 6 ≡ 1 mod 5 and 6 ≡ −1 mod 7
    assert.equal(addPoints({ x: 1n, y: 6n }, { x: 1n, y: 1n }, 0n, 35n), "undefined");
  });

  it("refuses a denominator sharing a factor with the modulus", () => {
    assert.equal(addPoints({ x: 1n, y: 1n }, { x: 6n, y: 2n }, 0n, 35n), "undefined"); // x differs by 5
  });
});

function floorRoot(value: bigint): bigint {
  let estimate = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const better = (estimate + value / estimate) >> 1n;
    if (better >= estimate) return estimate;
    estimate = better;
  }
}

describe("orderIsLargeEnough: q > (N^¼ + 1)²", () => {
  it("holds just past the bound, and not at or below it", () => {
    // N = 10^8 + 1 has N^¼ just over 100, so the bound is just over 101² = 10,201
    const n = 10n ** 8n + 1n;
    assert.equal(orderIsLargeEnough(101n * 101n, n), false);
    assert.equal(orderIsLargeEnough(102n * 102n, n), true);
    assert.equal(orderIsLargeEnough(102n * 102n - 1n, n), false, "rounds √q down: never accepts below the bound");
  });

  it("never accepts anything below the true bound, at any size", () => {
    for (const n of [10n ** 8n + 1n, 2n ** 127n - 1n, 10n ** 100n + 267n, 2n ** 521n - 1n]) {
      // (⌈N^¼⌉ + 1)² − 1 at most is below or at a bound computed from above
      const root = floorRoot(floorRoot(n)); // floor(N^¼)
      assert.equal(orderIsLargeEnough((root + 1n) ** 2n, n), false, `${n}`); // at or below (N^¼ + 1)²
      assert.equal(orderIsLargeEnough((root + 3n) ** 2n, n), true, `${n}`); // clearly past it
    }
  });

  it("is false for tiny values, rather than wrapping", () => {
    for (const q of [0n, 1n, 2n, 3n, 4n]) assert.equal(orderIsLargeEnough(q, 5n), false);
  });
});
