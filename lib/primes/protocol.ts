// Shared message protocol between the main thread and the prime worker.
// Both sides import from here so the contract stays type-checked.

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
  from: number;
  count: number;
}

export type WorkerRequest = BatchRequest;

export interface BatchResponse extends RequestTags {
  type: "batch";
  direction: Direction;
  /**
   * Primes in ascending order regardless of direction. Float64 is exact for
   * every integer up to 2^53, and the buffer is transferred, not copied.
   * May hold fewer than `count` primes for "prev" near 2.
   */
  primes: Float64Array;
  /** Wall time spent computing this batch, from performance.now(). */
  durationMs: number;
}

/** The next candidate would exceed Number.MAX_SAFE_INTEGER. */
export interface OverflowResponse extends RequestTags {
  type: "overflow";
}

export interface ErrorResponse extends RequestTags {
  type: "error";
  message: string;
}

export type WorkerResponse = BatchResponse | OverflowResponse | ErrorResponse;
