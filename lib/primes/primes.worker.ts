/// <reference lib="webworker" />
// STUB WORKER: a placeholder so the UI can run end to end.
// It uses naive trial division by odd numbers up to √n. The results are
// correct, but this is not the segmented sieve from CLAUDE.md. We'll replace
// it together.

import type { BatchRequest, WorkerRequest, WorkerResponse } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

function isPrime(candidate: number): boolean {
  if (candidate < 2) return false;
  if (candidate % 2 === 0) return candidate === 2;
  for (let divisor = 3; divisor * divisor <= candidate; divisor += 2) {
    if (candidate % divisor === 0) return false;
  }
  return true;
}

function sendToMainThread(response: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(response, transfer);
}

function handleBatchRequest({ id, generation, direction, from, count }: BatchRequest) {
  // performance.now() precision depends on cross-origin isolation (the
  // COOP/COEP headers in next.config.ts): microseconds when isolated, 0.1 ms
  // or coarser when not. Fast batches can still measure 0 ms; the rate meter
  // averages over many batches to handle that.
  const startTime = performance.now();
  const primesFound: number[] = [];

  if (direction === "next") {
    for (let candidate = Math.floor(from) + 1; primesFound.length < count; candidate++) {
      if (candidate > Number.MAX_SAFE_INTEGER) {
        sendToMainThread({ type: "overflow", id, generation });
        return;
      }
      if (isPrime(candidate)) primesFound.push(candidate);
    }
  } else {
    for (
      let candidate = Math.ceil(from) - 1;
      candidate >= 2 && primesFound.length < count;
      candidate--
    ) {
      if (isPrime(candidate)) primesFound.push(candidate);
    }
    primesFound.reverse(); // found largest-first; the protocol wants ascending order
  }

  const primes = Float64Array.from(primesFound);
  const durationMs = performance.now() - startTime;
  // Transferring the buffer hands it to the main thread without copying.
  sendToMainThread(
    { type: "batch", id, generation, direction, primes, durationMs },
    [primes.buffer],
  );
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    handleBatchRequest(request);
  } catch (error) {
    sendToMainThread({
      type: "error",
      id: request.id,
      generation: request.generation,
      message: String(error),
    });
  }
};
