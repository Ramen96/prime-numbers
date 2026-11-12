import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certifiedPrimeFrom } from "../../tests/support/curveCertificates.ts";
import type { VerificationRequest, VerificationResponse } from "./verificationPool.ts";

// The worker script only touches `self`: give it a stand-in, load it, and
// call its message handler the way the browser would.
const posted: VerificationResponse[] = [];
const standInSelf = {
  onmessage: null as ((event: { data: VerificationRequest }) => void) | null,
  postMessage: (response: VerificationResponse) => void posted.push(response),
};
(globalThis as unknown as { self: typeof standInSelf }).self = standInSelf;
await import("./verification.worker.ts");

function check(request: VerificationRequest): VerificationResponse {
  posted.length = 0;
  standInSelf.onmessage!({ data: request });
  assert.equal(posted.length, 1);
  return posted[0];
}

describe("verification.worker", () => {
  it("checks its share's primes", () => {
    const primesOnly = (primes: bigint[]): VerificationRequest => ({ primes, rejected: [], certificates: new Map() });
    assert.deepEqual(check(primesOnly([1_000_003n])).verification, { verified: true });
    assert.equal(check(primesOnly([2047n])).verification.verified, false);
  });

  it("checks its share's rejected composites too", () => {
    const rejectedOnly = (candidate: bigint): VerificationRequest => ({
      primes: [],
      rejected: [{ candidate, evidence: 3, kind: "evidence" }],
      certificates: new Map(),
    });
    assert.deepEqual(check(rejectedOnly(2047n)).verification, { verified: true });
    assert.deepEqual(check(rejectedOnly(1_000_003n)).verification, {
      verified: false,
      disputedComposite: 1_000_003n,
      evidence: 3,
      kind: "evidence",
    });
  });

  it("checks its share's primes past a(13) with their certificates", () => {
    const { prime, steps } = certifiedPrimeFrom(10n ** 30n);
    assert.deepEqual(check({ primes: [prime], rejected: [], certificates: new Map([[prime, steps]]) }).verification, {
      verified: true,
    });
    assert.equal(check({ primes: [prime], rejected: [], certificates: new Map() }).verification.verified, false);
  });
});
