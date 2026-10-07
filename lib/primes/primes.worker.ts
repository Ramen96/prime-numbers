/// <reference lib="webworker" />
// Finds primes with the segmented sieve in wasm/sieve.c, compiled to
// WebAssembly (public/sieve.wasm, built with `npm run build:wasm`).

import type { BatchRequest, WorkerRequest, WorkerResponse } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

/** What wasm/sieve.c exports, as seen from JavaScript. */
interface SieveModule {
  memory: WebAssembly.Memory;
  /** Byte offset of the output array (doubles) in memory. */
  output_buffer(): number;
  /** Writes up to `count` primes > `after` to the output, ascending. Returns how many. */
  sieve_next(after: number, count: number): number;
  /** Writes up to `count` primes < `before` to the output, ascending. Returns how many. */
  sieve_prev(before: number, count: number): number;
  /** Runs the C module's static initialisers; present in standalone builds. */
  _initialize?: () => void;
}

/**
 * sieve_next returns fewer primes than asked for only when it reaches 2^53, or
 * when memory runs out. The largest gap between primes below 2^53 is far
 * smaller than this margin, so a short batch that ends further down means memory.
 */
const NEAR_THE_END_OF_SAFE_INTEGERS = Number.MAX_SAFE_INTEGER - 1_000_000;

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

async function handleBatchRequest({ id, generation, direction, from, count }: BatchRequest) {
  const sieve = await sieveReady;

  // performance.now() precision depends on cross-origin isolation (the
  // COOP/COEP headers in next.config.ts): microseconds when isolated, 0.1 ms
  // or coarser when not. Fast batches can still measure 0 ms; the rate meter
  // averages over many batches to handle that.
  const startTime = performance.now();
  const primesWritten =
    direction === "next" ? sieve.sieve_next(from, count) : sieve.sieve_prev(from, count);
  // A fresh view every time: memory growth detaches views of the old buffer.
  // slice() copies the primes out, so what's transferred isn't wasm memory.
  const primes = new Float64Array(sieve.memory.buffer, sieve.output_buffer(), primesWritten).slice();
  const durationMs = performance.now() - startTime;

  if (direction === "next" && primesWritten < count) {
    const searchedUpTo = primesWritten > 0 ? primes[primesWritten - 1] : from;
    if (searchedUpTo < NEAR_THE_END_OF_SAFE_INTEGERS) {
      sendToMainThread({ type: "error", id, generation, message: "the sieve ran out of memory" });
      return;
    }
    if (primesWritten === 0) {
      // Nothing left below 2^53: every prime JavaScript can represent exactly has been shown.
      sendToMainThread({ type: "overflow", id, generation });
      return;
    }
    // Otherwise send the last few primes below 2^53 as a short batch. The
    // next request finds none and reports overflow.
  }

  // Transferring the buffer hands it to the main thread without copying.
  sendToMainThread(
    { type: "batch", id, generation, direction, primes, durationMs },
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
