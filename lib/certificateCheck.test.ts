import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certifiedPrimeFrom } from "../tests/support/curveCertificates.ts";
import { describeCheck, describeUnreadable, shortNumber } from "./certificateCheck.ts";
import { checkCertificate, type CertificateStep } from "./primes/primalityCertificate.ts";

const { prime, steps } = certifiedPrimeFrom(10n ** 60n);
const said = (forPrime: bigint, withSteps: CertificateStep[]) => describeCheck(forPrime, withSteps, checkCertificate(forPrime, withSteps));

describe("the check-a-certificate result line", () => {
  it("says a valid certificate proves the number, shortened, with its digits", () => {
    assert.ok(steps.length >= 3, "a chain long enough to break in the middle");
    assert.equal(said(prime, steps), `Valid: this certificate proves the 61-digit number ${shortNumber(prime)} prime.`);
  });

  it("names the step that doesn't hold, with the checker's reason", () => {
    const tampered = steps.map((step, index) => (index === 1 ? { ...step, pointY: step.pointY + 1n } : step));
    assert.equal(said(prime, tampered), `Not valid: step 2 of ${steps.length} doesn’t hold (the point isn’t on the curve).`);
  });

  it("says when a step doesn't continue the chain", () => {
    const broken = steps.map((step, index) => (index === 2 ? { ...step, number: step.number + 2n } : step));
    assert.equal(said(prime, broken), `Not valid: step 3 of ${steps.length} doesn’t continue the chain (its N isn’t step 2’s q).`);
  });

  it("says when the certificate is for another number", () => {
    assert.equal(said(prime + 2n, steps), "Not valid: step 1’s N isn’t the number the certificate is for.");
  });

  it("says when the chain stops before it's proven", () => {
    const short = steps.slice(0, 1);
    assert.match(said(prime, short), /^Not valid: the last step’s q, .*, isn’t proven prime \(it has to be below 3\.3 × 10²⁴\)\.$/);
  });

  it("finishes the sentence for one it couldn't read", () => {
    assert.equal(describeUnreadable({ readable: false, reason: "it’s empty" }), "That isn’t a certificate this page can read: it’s empty.");
  });

  it("shortens long numbers to their first four and last three digit groups", () => {
    assert.equal(shortNumber(1_234_567n), "1,234,567");
    assert.equal(shortNumber(10n ** 30n + 7n), "1,000,000,000,…,000,000,007");
  });
});
