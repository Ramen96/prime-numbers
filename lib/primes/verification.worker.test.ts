import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
    assert.deepEqual(check({ primes: [1_000_003n], rejected: [] }).verification, { verified: true });
    assert.equal(check({ primes: [2047n], rejected: [] }).verification.verified, false);
  });

  it("checks its share's rejected composites too", () => {
    assert.deepEqual(check({ primes: [], rejected: [{ candidate: 2047n, evidence: 3 }] }).verification, { verified: true });
    assert.deepEqual(check({ primes: [], rejected: [{ candidate: 1_000_003n, evidence: 3 }] }).verification, {
      verified: false,
      disputedComposite: 1_000_003n,
      evidence: 3,
    });
  });
});
