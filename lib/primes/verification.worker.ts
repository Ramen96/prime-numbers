/// <reference lib="webworker" />
// Checks one share of a batch (verifyPrimes.ts): its primes with Miller–Rabin,
// and its rejected composites' evidence, so a batch of big numbers is checked
// on several cores at once. Started by
// primes.worker.ts; see VerificationPool in verificationPool.ts.

import type { VerificationRequest, VerificationResponse } from "./verificationPool.ts";
import { verifyBatch } from "./verifyPrimes.ts";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<VerificationRequest>) => {
  const response: VerificationResponse = { verification: verifyBatch(event.data.primes, event.data.rejected) };
  self.postMessage(response);
};
