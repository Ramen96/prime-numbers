/// <reference lib="webworker" />
// Finds primes with the segmented sieve in wasm/sieve.c, compiled to
// WebAssembly: on several threads where the browser allows it, otherwise on
// this one (loadSieve.ts). Every value crossing the Wasm boundary goes
// through WasmSieve (wasmSieve.ts); what happens for each batch is in
// computeBatch.ts, and the primes are re-checked in plain workers
// (verificationPool.ts). Terminating this worker ends all of them: the sieve
// threads and the verification workers are nested inside it.

import { computeBatch } from "./computeBatch";
import { loadSieve, sievingThreadsFor } from "./loadSieve";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import { VerificationPool } from "./verificationPool";

declare const self: DedicatedWorkerGlobalScope;

// Starts loading as soon as the worker starts.
const sieveReady = loadSieve();

// Verification runs after sieving, while the sieve threads are idle, so it
// can use as many workers as there are sieving threads.
const verificationPool = new VerificationPool(
  sievingThreadsFor(self.navigator.hardwareConcurrency),
  () => new Worker(new URL("./verification.worker.ts", import.meta.url), { type: "module" }),
);

function sendToMainThread(response: WorkerResponse) {
  self.postMessage(response);
}

// One request at a time, in the order they arrived (computing is async while
// verification runs in other workers).
let previousRequest: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  previousRequest = previousRequest.then(async () => {
    try {
      const { sieve, threads, memoryBudgetBytes } = await sieveReady;
      await computeBatch(sieve, request, sendToMainThread, {
        memoryBudgetBytes,
        threads,
        verify: (primes) => verificationPool.verify(primes),
      });
    } catch (error) {
      sendToMainThread({
        type: "error",
        id: request.id,
        generation: request.generation,
        message: String(error),
      });
    }
  });
};
