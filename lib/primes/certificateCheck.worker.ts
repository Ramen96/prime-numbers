/// <reference lib="webworker" />
// Checks one certificate pasted or uploaded on the random-prime page, off the
// main thread so a long one doesn't freeze the page. checkCertificate itself,
// on the certificate as given: unlike verifyBatch (verification.worker.ts), it
// never proves a small number some other way while ignoring its certificate.

import { checkCertificate, type CertificateCheck, type CertificateStep } from "./primalityCertificate.ts";

declare const self: DedicatedWorkerGlobalScope;

export interface CertificateCheckRequest {
  prime: bigint;
  steps: CertificateStep[];
}

self.onmessage = (event: MessageEvent<CertificateCheckRequest>) => {
  const { prime, steps } = event.data;
  const check: CertificateCheck = checkCertificate(prime, steps);
  self.postMessage(check);
};
