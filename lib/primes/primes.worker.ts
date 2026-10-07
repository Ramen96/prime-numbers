/// <reference lib="webworker" />
// Finds primes with the segmented sieve in wasm/sieve.c, compiled to
// WebAssembly (public/sieve.wasm, built with `npm run build:wasm`). Every
// value crossing the Wasm boundary goes through WasmSieve (wasmSieve.ts); what
// happens for each batch is in computeBatch.ts.

import { computeBatch } from "./computeBatch";
import { basePrimeMemoryBudget } from "./memoryBudget";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import { WasmSieve, type RawSieveExports } from "./wasmSieve";

declare const self: DedicatedWorkerGlobalScope;

// Half the device's memory, where the browser says how much there is
// (navigator.deviceMemory isn't in TypeScript's lib, or in Safari and
// Firefox). Null: no budget, so base primes grow until an allocation fails.
const memoryBudgetBytes = basePrimeMemoryBudget(
  (self.navigator as WorkerNavigator & { deviceMemory?: number }).deviceMemory,
);

// Starts loading as soon as the worker starts. Requests that arrive first wait
// for it, and are handled in the order they arrived.
const sieveReady: Promise<WasmSieve> = loadSieve();

async function loadSieve(): Promise<WasmSieve> {
  const { instance } = await WebAssembly.instantiateStreaming(fetch("/sieve.wasm"), {
    // Called when the module's memory grows. Nothing to do here: WasmSieve
    // reads through a fresh view of memory.buffer every time.
    env: { emscripten_notify_memory_growth: () => {} },
  });
  const raw = instance.exports as unknown as RawSieveExports;
  raw._initialize?.();
  const sieve = new WasmSieve(raw);
  if (memoryBudgetBytes !== null) sieve.setBasePrimeMemoryBudget(memoryBudgetBytes);
  return sieve;
}

function sendToMainThread(response: WorkerResponse) {
  self.postMessage(response);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    computeBatch(await sieveReady, request, sendToMainThread, { memoryBudgetBytes });
  } catch (error) {
    sendToMainThread({
      type: "error",
      id: request.id,
      generation: request.generation,
      message: String(error),
    });
  }
};
