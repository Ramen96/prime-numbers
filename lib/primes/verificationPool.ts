// Miller–Rabin verification (Requirement A3) spread over plain workers.
//
// Checking a batch of big primes takes long enough to matter (about 9 ms per
// batch near 2^63 on a laptop, 56 ms on a slow phone core), and it runs after
// sieving, when the sieving threads are idle. So the batch is split into
// shares, checked in parallel, and the answers joined in order: the first
// prime that isn't proven, in batch order, is the one reported. Small primes
// are checked inline, where messaging would cost more than checking.
// If the workers can't be used, verification is inline: slower, never skipped.

import { verifyPrimes, type BatchVerification } from "./verifyPrimes.ts";

export interface VerificationRequest {
  primes: bigint[];
}
export interface VerificationResponse {
  verification: BatchVerification;
}

/** Below this, a batch is checked inline (about 3 ms per batch at 2^32 on a laptop). */
export const SMALLEST_PRIME_WORTH_SHARING = 2n ** 32n;

/** Splits `primes` into `shareCount` consecutive shares, as even as possible, none empty. */
export function splitIntoShares<T>(primes: readonly T[], shareCount: number): T[][] {
  const count = Math.max(1, Math.min(shareCount, primes.length));
  return Array.from({ length: count }, (_, index) =>
    primes.slice(Math.floor((primes.length * index) / count), Math.floor((primes.length * (index + 1)) / count)),
  );
}

/** The first share (in order) that isn't verified decides; otherwise all are verified. */
export function joinVerifications(verifications: readonly BatchVerification[]): BatchVerification {
  return verifications.find((verification) => !verification.verified) ?? { verified: true };
}

export class VerificationPool {
  readonly #createWorker: () => Worker;
  readonly #size: number;
  #workers: Worker[] | null = null;
  #unusable = false;

  /** `size` workers at most, started on first use. */
  constructor(size: number, createWorker: () => Worker) {
    this.#size = size;
    this.#createWorker = createWorker;
  }

  async verify(primes: readonly bigint[]): Promise<BatchVerification> {
    const largest = primes.at(-1);
    if (this.#size < 2 || this.#unusable || largest === undefined || largest < SMALLEST_PRIME_WORTH_SHARING) {
      return verifyPrimes(primes);
    }
    try {
      const workers = (this.#workers ??= Array.from({ length: this.#size }, () => this.#createWorker()));
      const shares = splitIntoShares(primes, workers.length);
      const verifications = await Promise.all(
        shares.map((share, index) => this.#verifyShare(workers[index], share)),
      );
      return joinVerifications(verifications);
    } catch (error) {
      // a worker failed (or couldn't start): check inline from now on
      console.warn("Verification workers unavailable, checking inline:", error);
      this.#unusable = true;
      this.#workers?.forEach((worker) => worker.terminate());
      this.#workers = null;
      return verifyPrimes(primes);
    }
  }

  #verifyShare(worker: Worker, primes: bigint[]): Promise<BatchVerification> {
    return new Promise((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<VerificationResponse>) => resolve(event.data.verification);
      worker.onerror = (event) => {
        event.preventDefault();
        reject(new Error(event.message || "verification worker failed"));
      };
      const request: VerificationRequest = { primes };
      worker.postMessage(request);
    });
  }
}
