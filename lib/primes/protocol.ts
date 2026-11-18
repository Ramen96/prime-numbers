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

/**
 * Stop proving for request `id` (Stop, while the worker is proving). Handled at
 * once, not queued: the worker stops after its current bounded run and keeps
 * every unfinished proof, for a later request that asks for the same numbers.
 */
export interface PauseRequest {
  type: "pause";
  id: number;
}

export type WorkerRequest = BatchRequest | PauseRequest;

/** Sent before a batch whose base primes have to be built first, which can take a while. */
export interface BuildingBasePrimesNotice extends RequestTags {
  type: "building-base-primes";
}

/**
 * Sent when a batch has been sieved and its primes past a(13) are being proven.
 * From here until the batch arrives, a pause request stops it without losing work.
 */
export interface ProvingNotice extends RequestTags {
  type: "proving";
}

/**
 * How the proof of the prime the list is waiting on is going, at most about
 * once a second while it's being proven (the “proving primality…” row).
 */
export interface ProvingProgressNotice extends RequestTags {
  type: "proving-progress";
  direction: Direction;
  /** How long the list has waited on this prime so far. */
  elapsedMs: number;
  /** Its digits. */
  digits: number;
  /** About how many digits the number its chain has reached has: `digits` at the start, fewer as it goes down. */
  reachedDigits: number;
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
   * Primes in ascending order regardless of direction: the rest of the batch,
   * after any already sent in `proven` messages (then possibly none). The whole
   * batch may hold fewer than `count` primes: for "prev" near 2, or when memory
   * ran out settling a number (`reachedMemoryLimit`).
   */
  primes: bigint[];
  /** How many of `primes` were found now, rather than kept from an earlier proof. */
  foundCount: number;
  /** Memory ran out before the next number could be settled: sieved, or past a(13), proven. */
  reachedMemoryLimit: boolean;
  /**
   * Time spent finding this message's primes, from performance.now(): sieving,
   * and past a(13) proving them. The speed counter uses only this.
   */
  sievingDurationMs: number;
  /**
   * Time spent setting up, not sieving: building base primes, and on the
   * threaded build, timing where splitting a window across threads pays.
   * 0 when neither was needed.
   */
  setupDurationMs: number;
  /**
   * Time spent re-checking every prime before sending it, with Miller–Rabin or
   * past a(13) its certificate (Requirement A3). Like setup, it isn't part of the speed counter.
   */
  verificationDurationMs: number;
  memory: WorkerMemory;
  /** Threads sieving each window: 1 on the single-threaded build. */
  threads: number;
}

/**
 * No primes could be proven at all for this request: memory ran out before
 * the first number could be settled. Nothing is skipped or guessed;
 * everything from `from` on stays unchecked.
 */
export interface MemoryLimitResponse extends RequestTags {
  type: "memory-limit";
  memory: WorkerMemory;
}

/**
 * Primes past a(13) are shown as soon as they're proven and checked (step 5),
 * so a batch arrives in pieces: any number of these, then the `batch` with the
 * rest. Each piece continues the one before, in the order primes join the list.
 */
export interface ProvenPrimesResponse extends RequestTags {
  type: "proven";
  direction: Direction;
  /** The next primes of the batch, ascending; every one proven and checked. */
  primes: bigint[];
  /** How many were found now, rather than kept from an earlier proof. */
  foundCount: number;
  /** Time spent finding them, since the previous piece (sieving, for the first). */
  findingDurationMs: number;
}

/** Proving stopped for a pause request: nothing from this batch is sent, and no proof is lost. */
export interface PausedResponse extends RequestTags {
  type: "paused";
}

export interface ErrorResponse extends RequestTags {
  type: "error";
  message: string;
}

export type WorkerResponse =
  | BuildingBasePrimesNotice
  | ProvingNotice
  | ProvingProgressNotice
  | ProvenPrimesResponse
  | PausedResponse
  | BatchResponse
  | MemoryLimitResponse
  | ErrorResponse;
