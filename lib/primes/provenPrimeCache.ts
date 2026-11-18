// Primes past a(13) that have already been proven and checked, kept by the
// worker so scrolling back, or asking again after Stop, doesn't prove them
// again (CLAUDE.md, Road to completion, step 5).
//
// Below a(13) the list recomputes instead of storing (the rolling buffer's
// point: memory stays flat), since a prime there costs microseconds. Past
// it, each one costs a proof, from milliseconds to minutes, so the cheapest
// thing is to remember it.
//
// Only primes whose certificates passed the independent check (Requirement
// A3) are ever added, so a prime found here has been checked once already. The
// cache has a memory cap, and when it's full the oldest prime goes first. That
// cap only ever costs time: a prime that's dropped is simply proven again.

/** Room for the cache by default: thousands of primes of a few hundred digits. */
export const DEFAULT_CACHE_BYTES = 16 * 2 ** 20;

/**
 * A rough cost of keeping one prime: its bytes, plus what a Map entry and a
 * BigInt take besides (an estimate; the cap is about not growing without bound,
 * not about exact bytes).
 */
export function cachedPrimeBytes(prime: bigint): number {
  const ENTRY_OVERHEAD_BYTES = 64;
  return ENTRY_OVERHEAD_BYTES + Math.ceil(prime.toString(16).length / 2);
}

export class ProvenPrimeCache {
  readonly #capacityBytes: number;
  /** Insertion order is age: the first entry is the oldest. Values are each entry's cost. */
  readonly #primes = new Map<bigint, number>();
  #bytes = 0;

  constructor(capacityBytes = DEFAULT_CACHE_BYTES) {
    this.#capacityBytes = capacityBytes;
  }

  /** Whether `prime` was proven and checked, and is still kept. */
  has(prime: bigint): boolean {
    return this.#primes.has(prime);
  }

  /** Keeps a proven, checked prime as the newest, dropping the oldest if that's over the cap. */
  add(prime: bigint): void {
    const existing = this.#primes.get(prime);
    if (existing !== undefined) {
      this.#primes.delete(prime); // re-added below as the newest
      this.#bytes -= existing;
    }
    const cost = cachedPrimeBytes(prime);
    this.#primes.set(prime, cost);
    this.#bytes += cost;
    for (const [oldest, oldestCost] of this.#primes) {
      if (this.#bytes <= this.#capacityBytes) break;
      this.#primes.delete(oldest);
      this.#bytes -= oldestCost;
    }
  }

  /** How many primes are kept. */
  get size(): number {
    return this.#primes.size;
  }

  /** The estimated bytes they take. */
  get bytes(): number {
    return this.#bytes;
  }
}
