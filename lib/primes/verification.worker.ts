/// <reference lib="webworker" />
// Checks one share of a batch with Miller–Rabin (verifyPrimes.ts), so a
// batch of big primes is checked on several cores at once. Started by
// primes.worker.ts; see VerificationPool in verificationPool.ts.

import type { VerificationRequest, VerificationResponse } from "./verificationPool";
import { verifyPrimes } from "./verifyPrimes";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<VerificationRequest>) => {
  const response: VerificationResponse = { verification: verifyPrimes(event.data.primes) };
  self.postMessage(response);
};
