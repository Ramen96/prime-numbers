// Miller–Rabin verification (Requirement A3) spread over plain workers.
//
// Checking a batch of big primes takes long enough to matter (about 9 ms per
// batch near 2^63 on a laptop, 56 ms on a slow phone core), and it runs after
// sieving, when the sieving threads are idle. So the batch is split into
// shares, checked in parallel, and the answers joined in order: the first
// share with a dispute decides (within a share, primes are checked before
// rejected composites). Small batches are checked inline, where messaging
// would cost more than checking. If the workers can't be used, verification
// is inline: slower, never skipped.

import { verifyBatch, type BatchVerification } from "./verifyPrimes.ts";
import type { RejectedComposite } from "./wasmSieve.ts";

export interface VerificationRequest {
  primes: bigint[];
  /** Survivors the sieve's Miller–Rabin rejected, with their evidence (Phase 4). */
  rejected: RejectedComposite[];
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

  async verify(primes: readonly bigint[], rejected: readonly RejectedComposite[] = []): Promise<BatchVerification> {
    const numbersToCheck = primes.length + rejected.length;
    const anyBig =
      (primes.at(-1) ?? 0n) >= SMALLEST_PRIME_WORTH_SHARING ||
      rejected.some(({ candidate }) => candidate >= SMALLEST_PRIME_WORTH_SHARING);
    if (this.#size < 2 || this.#unusable || numbersToCheck === 0 || !anyBig) {
      return verifyBatch(primes, rejected);
    }
    try {
      const workers = (this.#workers ??= Array.from({ length: this.#size }, () => this.#createWorker()));
      // as many shares as workers; the rejected composites are shared out the same way
      const shareCount = Math.min(workers.length, Math.max(primes.length, rejected.length));
      const primeShares = splitIntoShares(primes, shareCount);
      const rejectedShares = splitIntoShares(rejected, shareCount);
      const verifications = await Promise.all(
        Array.from({ length: shareCount }, (_, index) =>
          this.#verifyShare(workers[index], primeShares[index] ?? [], rejectedShares[index] ?? []),
        ),
      );
      return joinVerifications(verifications);
    } catch (error) {
      // a worker failed (or couldn't start): check inline from now on
      console.warn("Verification workers unavailable, checking inline:", error);
      this.#unusable = true;
      this.#workers?.forEach((worker) => worker.terminate());
      this.#workers = null;
      return verifyBatch(primes, rejected);
    }
  }

  #verifyShare(worker: Worker, primes: bigint[], rejected: RejectedComposite[]): Promise<BatchVerification> {
    return new Promise((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<VerificationResponse>) => resolve(event.data.verification);
      worker.onerror = (event) => {
        event.preventDefault();
        reject(new Error(event.message || "verification worker failed"));
      };
      const request: VerificationRequest = { primes, rejected };
      worker.postMessage(request);
    });
  }
}
