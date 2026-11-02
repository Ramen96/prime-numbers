// What's been measured about this device, for the life of one worker, and the
// timing runs that measure it (the decisions are in methodCalibration.ts).
// Measured lazily, since most visits never need it: where to switch to partial
// sieving, and its cap, on the first batch past 2^32; the cap for multi-limb
// numbers, on the first batch past 2^64. The timed batches are never shown.

import type { Sieve } from "./computeBatch.ts";
import { basePrimesCouldFit, estimatedBasePrimeBytes } from "./memoryBudget.ts";
import { findFastestCap, findPartialSieveStart, type MethodsDisagree, type TimedBatch } from "./methodCalibration.ts";
import { BATCH_SIZE } from "./protocol.ts";
import { basePrimeLimitNeededFor, NO_SIEVE_PRIME_CAP } from "./wasmSieve.ts";

/**
 * The cap until one is measured, and when the full sieve doesn't fit below the
 * measured switch: the primes below 65,536 that the sieve always builds first.
 */
export const PARTIAL_SIEVE_PRIME_CAP = 65_535n;

/** Below this, base primes up to PARTIAL_SIEVE_PRIME_CAP are already all a window needs: nothing to decide. */
const CALIBRATE_FROM = 2n ** 32n;
/** From here, Miller–Rabin takes its multi-limb path, whose costs differ. */
const MULTI_LIMB_FROM = 2n ** 64n;
/** Where the multi-limb cap is timed: past the limb change, and far below the proven bound. */
const MULTI_LIMB_TIMED_AT = 2n ** 66n;

/**
 * Reserves storage for every base prime up to `limit` from an estimate, within
 * the budget, then builds them. False if they turn out not to fit.
 */
export function buildBasePrimes(sieve: Sieve, limit: bigint, memoryBudgetBytes: number | null): boolean {
  const estimatedBytes = estimatedBasePrimeBytes(limit);
  sieve.reserveBasePrimeStorage(
    memoryBudgetBytes === null ? estimatedBytes : Math.min(estimatedBytes, memoryBudgetBytes),
  );
  return sieve.extendBasePrimes(limit);
}

export type CapDecision =
  /** `cap` is null for the full sieve; `setupMs` is what measuring just took. */
  | { agreed: true; cap: bigint | null; setupMs: number }
  | MethodsDisagree;

export class SieveCalibrator {
  readonly #sieve: Sieve;
  readonly #memoryBudgetBytes: number | null;
  readonly #now: () => number;
  #partialSieveFrom: bigint | null = null;
  #cap = PARTIAL_SIEVE_PRIME_CAP;
  #multiLimbCap: bigint | null = null;

  constructor(sieve: Sieve, memoryBudgetBytes: number | null, now: () => number = () => performance.now()) {
    this.#sieve = sieve;
    this.#memoryBudgetBytes = memoryBudgetBytes;
    this.#now = now;
  }

  /** How to sieve a batch from `from`, measuring first if this is the first time it matters. */
  capFor(from: bigint): CapDecision {
    if (from < CALIBRATE_FROM) return { agreed: true, cap: null, setupMs: 0 };
    const startTime = this.#now();
    let measured = false;
    // exactly 0 unless something was measured: the stats show the last setup that took any time
    const setupMs = () => (measured ? this.#now() - startTime : 0);

    if (this.#partialSieveFrom === null) {
      measured = true;
      const start = findPartialSieveStart(
        (place) => this.#timeFullSieve(place),
        (place, cap) => this.#timePartialSieve(place, cap),
        PARTIAL_SIEVE_PRIME_CAP,
      );
      if (!start.agreed) return start;
      const fastest = findFastestCap((place, cap) => this.#timePartialSieve(place, cap), start.partialSieveFrom);
      if (!fastest.agreed) return fastest;
      this.#partialSieveFrom = start.partialSieveFrom;
      this.#cap = fastest.cap;
    }
    if (from < this.#partialSieveFrom) return { agreed: true, cap: null, setupMs: setupMs() };
    if (from < MULTI_LIMB_FROM) return { agreed: true, cap: this.#cap, setupMs: setupMs() };

    if (this.#multiLimbCap === null) {
      measured = true;
      const fastest = findFastestCap((place, cap) => this.#timePartialSieve(place, cap), MULTI_LIMB_TIMED_AT);
      if (!fastest.agreed) return fastest;
      this.#multiLimbCap = fastest.cap;
    }
    return { agreed: true, cap: this.#multiLimbCap, setupMs: setupMs() };
  }

  #timeFullSieve(from: bigint): TimedBatch | null {
    const limit = basePrimeLimitNeededFor("next", from, BATCH_SIZE);
    if (!basePrimesCouldFit(limit, this.#memoryBudgetBytes)) return null;
    if (limit >= this.#sieve.basePrimeLimit() && !buildBasePrimes(this.#sieve, limit, this.#memoryBudgetBytes)) {
      return null;
    }
    return this.#timeBatch(from, NO_SIEVE_PRIME_CAP);
  }

  #timePartialSieve(from: bigint, cap: bigint): TimedBatch {
    return this.#timeBatch(from, cap);
  }

  /** Time spent measuring where splitting pays isn't this method's cost, so it's left out. */
  #timeBatch(from: bigint, cap: bigint): TimedBatch {
    this.#sieve.setSievePrimeCap(cap);
    const startTime = this.#now();
    const { primes, measuringMs } = this.#sieve.findPrimes("next", from, BATCH_SIZE);
    return { durationMs: this.#now() - startTime - measuringMs, primes };
  }
}
