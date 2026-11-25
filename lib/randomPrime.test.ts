import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certifiedPrimeFrom } from "../tests/support/curveCertificates.ts";
import {
  parseDigits,
  RANDOM_PRIME_DEFAULT_DIGITS,
  RANDOM_PRIME_MIN_DIGITS,
  randomPrimeOutcome,
  randomPrimeRequest,
} from "./randomPrime.ts";
import { DETERMINISTIC_VERIFICATION_LIMIT } from "./primes/verifyPrimes.ts";

describe("randomPrime", () => {
  it("starts at 26 digits, the first length wholly past a(13), so every prime has a certificate", () => {
    assert.ok(10n ** BigInt(RANDOM_PRIME_MIN_DIGITS - 1) > DETERMINISTIC_VERIFICATION_LIMIT);
    assert.ok(10n ** BigInt(RANDOM_PRIME_MIN_DIGITS - 2) < DETERMINISTIC_VERIFICATION_LIMIT);
    assert.equal(RANDOM_PRIME_DEFAULT_DIGITS, 100);
  });

  it("reads a whole number of digits from 26 up, with no upper limit", () => {
    assert.deepEqual(parseDigits("100"), { valid: true, digits: 100 });
    assert.deepEqual(parseDigits(" 1,000 "), { valid: true, digits: 1000 });
    assert.deepEqual(parseDigits("26"), { valid: true, digits: 26 });
    assert.deepEqual(parseDigits("1000000"), { valid: true, digits: 1_000_000 });
    for (const typed of ["", "25", "1", "abc", "2.5", "-30", "1e3"]) assert.equal(parseDigits(typed).valid, false, typed);
    assert.match((parseDigits("25") as { message: string }).message, /At least 26 digits/);
  });

  it("asks for the first prime from the start itself, with its certificate, as a lone proof, on the GPU only if asked", () => {
    assert.deepEqual(randomPrimeRequest(7, 10n ** 99n), {
      type: "batch",
      id: 7,
      generation: 1,
      direction: "next",
      from: 10n ** 99n - 1n,
      count: 1,
      includeCertificates: true,
      useGpu: false,
      loneProof: true,
    });
    assert.equal(randomPrimeRequest(7, 10n ** 99n, true).useGpu, true);
  });

  it("is found only with the prime's own certificate, and draws again when it has a digit too many", () => {
    const { prime, steps } = certifiedPrimeFrom(10n ** 25n);
    const digits = prime.toString().length;
    assert.deepEqual(randomPrimeOutcome(digits, [prime], [{ prime, steps }]), { kind: "found", prime, certificate: steps });
    assert.deepEqual(randomPrimeOutcome(digits - 1, [prime], [{ prime, steps }]), { kind: "draw-again" });
    assert.equal(randomPrimeOutcome(digits, [prime], []).kind, "error");
    assert.equal(randomPrimeOutcome(digits, [prime], [{ prime: prime + 2n, steps }]).kind, "error");
    assert.equal(randomPrimeOutcome(digits, [], []).kind, "error");
  });
});
