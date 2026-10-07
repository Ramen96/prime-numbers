/// <reference lib="webworker" />
// Finds primes with the segmented sieve in wasm/sieve.c, compiled to
// WebAssembly (public/sieve.wasm, built with `npm run build:wasm`).

import {
  SIEVE_LIMIT,
  type BatchRequest,
  type Direction,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

/** What wasm/sieve.c exports, as seen from JavaScript. 64-bit integers cross as BigInt. */
interface SieveModule {
  memory: WebAssembly.Memory;
  /** Byte offset of the output array (uint64_t) in memory. */
  output_buffer(): number;
  /** Writes up to `count` primes > `after` to the output, ascending. Returns how many. */
  sieve_next(after: bigint, count: number): number;
  /** Writes up to `count` primes < `before` to the output, ascending. Returns how many. */
  sieve_prev(before: bigint, count: number): number;
  /** Exclusive: every prime below this is a base prime already (0 before any work). */
  base_prime_limit(): bigint;
  /** Makes sure every prime ≤ `limit` is a base prime. Returns 0 if memory runs out. */
  extend_base_primes(limit: bigint): number;
  /** Runs the C module's static initialisers; present in standalone builds. */
  _initialize?: () => void;
}

/** Numbers covered by one segment in sieve.c (2 × SEGMENT_BYTES: odd numbers only). */
const SEGMENT_SPAN = 65_536;
/**
 * How many average prime gaps to allow per prime when guessing how far a batch
 * reaches. Generous: guessing short only means sieve_next builds the rest of
 * the base primes itself (counted as sieving time); guessing long costs nothing
 * extra later, since those base primes would be needed soon anyway.
 */
const PRIME_GAP_MARGIN = 4;
/**
 * sieve_next returns fewer primes than asked for only when it reaches
 * SIEVE_LIMIT, or when memory runs out. The largest gap between primes below
 * 2^53 is far smaller than this margin, so a short batch that ends further
 * down means memory.
 */
const NEAR_THE_SIEVE_LIMIT = SIEVE_LIMIT - 1_000_000n;

// Starts loading as soon as the worker starts. Requests that arrive first wait
// for it, and are handled in the order they arrived.
const sieveReady: Promise<SieveModule> = loadSieve();

async function loadSieve(): Promise<SieveModule> {
  const { instance } = await WebAssembly.instantiateStreaming(fetch("/sieve.wasm"), {
    // Called when the module's memory grows. Nothing to do here: batches are
    // read through a fresh view of memory.buffer every time.
    env: { emscripten_notify_memory_growth: () => {} },
  });
  const sieve = instance.exports as unknown as SieveModule;
  sieve._initialize?.();
  return sieve;
}

function sendToMainThread(response: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(response, transfer);
}

/**
 * The base primes a batch will need: every prime up to √ of the last number
 * it's likely to sieve. Primes near x are about ln x apart on average, and the
 * sieve always works in whole segments.
 */
function basePrimeLimitNeededFor(direction: Direction, from: bigint, count: number): bigint {
  const fromAsNumber = Number(from);
  const averagePrimeGap = Math.log(Math.max(fromAsNumber, 3));
  const likelyLastNumber =
    direction === "next"
      ? fromAsNumber + count * averagePrimeGap * PRIME_GAP_MARGIN + SEGMENT_SPAN
      : fromAsNumber + SEGMENT_SPAN;
  const lastNumberTheSieveReaches = Number(SIEVE_LIMIT) + SEGMENT_SPAN;
  return BigInt(Math.ceil(Math.sqrt(Math.min(likelyLastNumber, lastNumberTheSieveReaches))));
}

async function handleBatchRequest({ id, generation, direction, from, count }: BatchRequest) {
  const sieve = await sieveReady;

  // performance.now() precision depends on cross-origin isolation (the
  // COOP/COEP headers in next.config.ts): microseconds when isolated, 0.1 ms
  // or coarser when not. Fast batches can still measure 0 ms; the rate meter
  // averages over many batches to handle that.

  // Step 1, timed on its own: build any base primes this batch needs. It can
  // take a while after a big jump, and isn't sieving speed. The C call can't
  // report progress, so say so before starting.
  let setupDurationMs = 0;
  const basePrimeLimitNeeded = basePrimeLimitNeededFor(direction, from, count);
  if (basePrimeLimitNeeded >= sieve.base_prime_limit()) {
    sendToMainThread({ type: "building-base-primes", id, generation });
    const setupStartTime = performance.now();
    const extended = sieve.extend_base_primes(basePrimeLimitNeeded);
    setupDurationMs = performance.now() - setupStartTime;
    if (!extended) {
      sendToMainThread({ type: "error", id, generation, message: "the sieve ran out of memory" });
      return;
    }
  }

  // Step 2, timed on its own: sieve. (sieve_next/sieve_prev still extend the
  // base primes themselves if step 1 guessed short.)
  const sievingStartTime = performance.now();
  const primesWritten =
    direction === "next" ? sieve.sieve_next(from, count) : sieve.sieve_prev(from, count);
  // A fresh view every time: memory growth detaches views of the old buffer.
  // slice() copies the primes out, so what's transferred isn't wasm memory.
  const primes = new BigUint64Array(
    sieve.memory.buffer,
    sieve.output_buffer(),
    primesWritten,
  ).slice();
  const sievingDurationMs = performance.now() - sievingStartTime;

  if (direction === "next" && primesWritten < count) {
    const searchedUpTo = primesWritten > 0 ? primes[primesWritten - 1] : from;
    if (searchedUpTo < NEAR_THE_SIEVE_LIMIT) {
      sendToMainThread({ type: "error", id, generation, message: "the sieve ran out of memory" });
      return;
    }
    if (primesWritten === 0) {
      // Nothing left below the sieve's limit.
      sendToMainThread({ type: "overflow", id, generation });
      return;
    }
    // Otherwise send the last few primes below the limit as a short batch.
    // The next request finds none and reports overflow.
  }

  // Transferring the buffer hands it to the main thread without copying.
  sendToMainThread(
    { type: "batch", id, generation, direction, primes, sievingDurationMs, setupDurationMs },
    [primes.buffer],
  );
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    await handleBatchRequest(request);
  } catch (error) {
    sendToMainThread({
      type: "error",
      id: request.id,
      generation: request.generation,
      message: String(error),
    });
  }
};
