// Shared message protocol between the main thread and the prime worker.
// Both sides import from here so the contract stays type-checked.
// Prime values are BigInt throughout: 64-bit integers from the Wasm sieve.

export type Direction = "next" | "prev";

/** Number of primes per batch. The rolling buffer holds 3 of these. */
export const BATCH_SIZE = 500;

/**
 * The sieve's upper limit, 2^53 − 1 (SIEVE_LIMIT in wasm/sieve.c). Its base
 * primes stop growing at √ of this, so it finds no primes past it.
 */
export const SIEVE_LIMIT = 9_007_199_254_740_991n;

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

export interface BatchResponse extends RequestTags {
  type: "batch";
  direction: Direction;
  /**
   * Primes in ascending order regardless of direction. The buffer is
   * transferred, not copied. May hold fewer than `count` primes: for "prev"
   * near 2, and for "next" just below SIEVE_LIMIT, where the sieve's primes run out.
   */
  primes: BigUint64Array;
  /** Time spent sieving this batch, from performance.now(). The speed counter uses only this. */
  sievingDurationMs: number;
  /** Time spent building base primes before sieving; 0 when none were needed. */
  setupDurationMs: number;
}

/** There are no more primes below SIEVE_LIMIT after `from`. */
export interface OverflowResponse extends RequestTags {
  type: "overflow";
}

export interface ErrorResponse extends RequestTags {
  type: "error";
  message: string;
}

export type WorkerResponse =
  | BuildingBasePrimesNotice
  | BatchResponse
  | OverflowResponse
  | ErrorResponse;
