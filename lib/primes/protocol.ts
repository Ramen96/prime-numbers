// Shared message protocol between the main thread and the prime worker.
// Both sides import from here so the contract stays type-checked.
// Prime values are BigInt throughout, of any size: the Wasm sieve hands them
// over as limbs and offsets (see wasmSieve.ts), never as JS numbers.

export type Direction = "next" | "prev";

/** Number of primes per batch. The rolling buffer holds 3 of these. */
export const BATCH_SIZE = 500;

/**
 * Every message carries two tags:
 * - `id` identifies one request, so a response can be matched to it.
 * - `generation` identifies which buffer the request was made for. A jump
 *   throws the buffer away and bumps the generation, so any response from
 *   before the jump is recognised as stale and ignored.
 * The worker never interprets either tag; it just echoes them back.
 */
interface RequestTags {
  id: number;
  generation: number;
}

export interface BatchRequest extends RequestTags {
  type: "batch";
  direction: Direction;
  /**
   * Exclusive bound. "next": primes strictly greater than `from`.
   * "prev": primes strictly less than `from`.
   */
  from: bigint;
  count: number;
}

export type WorkerRequest = BatchRequest;

/** Sent before a batch whose base primes have to be built first, which can take a while. */
export interface BuildingBasePrimesNotice extends RequestTags {
  type: "building-base-primes";
}

/** The worker's memory, sent with every result (Wasm memory only grows). */
export interface WorkerMemory {
  /** Bytes allocated for base primes. */
  basePrimeBytes: number;
  /** Everything the Wasm module holds, base primes included. */
  moduleBytes: number;
}

export interface BatchResponse extends RequestTags {
  type: "batch";
  direction: Direction;
  /**
   * Primes in ascending order regardless of direction. May hold fewer than
   * `count` primes: for "prev" near 2, or when the sieve reached this device's
   * memory limit part way through (then `reachedMemoryLimit` is set).
   */
  primes: bigint[];
  /** The sieve stopped because the base primes it needs next don't fit in memory. */
  reachedMemoryLimit: boolean;
  /** Time spent sieving this batch, from performance.now(). The speed counter uses only this. */
  sievingDurationMs: number;
  /**
   * Time spent setting up, not sieving: building base primes, and on the
   * threaded build, timing where splitting a window across threads pays.
   * 0 when neither was needed.
   */
  setupDurationMs: number;
  /**
   * Time spent re-checking every prime with Miller–Rabin before sending it
   * (Requirement A3). Like setup, it isn't part of the speed counter.
   */
  verificationDurationMs: number;
  memory: WorkerMemory;
  /** Threads sieving each window: 1 on the single-threaded build. */
  threads: number;
}

/**
 * No primes could be proven at all for this request: the base primes the
 * sieve would need don't fit in this device's memory. Nothing is skipped or
 * guessed; everything from `from` on stays unchecked.
 */
export interface MemoryLimitResponse extends RequestTags {
  type: "memory-limit";
  memory: WorkerMemory;
}

export interface ErrorResponse extends RequestTags {
  type: "error";
  message: string;
}

export type WorkerResponse =
  | BuildingBasePrimesNotice
  | BatchResponse
  | MemoryLimitResponse
  | ErrorResponse;
