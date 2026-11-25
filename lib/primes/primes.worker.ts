/// <reference lib="webworker" />
// Finds primes with the segmented sieve in wasm/sieve.c, compiled to
// WebAssembly: on several threads where the browser allows it, otherwise on
// this one (loadSieve.ts). Every value crossing the Wasm boundary goes
// through WasmSieve (wasmSieve.ts); what happens for each batch is in
// computeBatch.ts, and the primes are re-checked in plain workers
// (verificationPool.ts). Terminating this worker ends all of them: the sieve
// threads and the verification workers are nested inside it.

import { computeBatch } from "./computeBatch";
import { GpuStrippingControl } from "./gpuStrippingControl";
import { loadSieve, sievingThreadsFor } from "./loadSieve";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import { ProvenPrimeCache } from "./provenPrimeCache";
import { RequestStops, yieldToMessages } from "./requestStops";
import { SieveCalibrator } from "./sieveCalibrator";
import type { ProofWork } from "./stripDepth";
import { VerificationPool } from "./verificationPool";
import { VERIFICATION_WORKER_NAME } from "./workerNames";

declare const self: DedicatedWorkerGlobalScope;

// Starts loading as soon as the worker starts.
const sieveReady = loadSieve();

// Verification runs after sieving, while the sieve threads are idle, so it
// can use as many workers as there are sieving threads.
const verificationPool = new VerificationPool(
  sievingThreadsFor(self.navigator.hardwareConcurrency),
  () =>
    new Worker(new URL("./verification.worker.ts", import.meta.url), {
      type: "module",
      name: VERIFICATION_WORKER_NAME,
    }),
);

function sendToMainThread(response: WorkerResponse) {
  self.postMessage(response);
}

// One request at a time, in the order they arrived (computing is async while
// verification runs in other workers). A pause isn't queued: it's noted at
// once, and the running request sees it between proving runs (requestStops.ts).
let previousRequest: Promise<void> = Promise.resolve();
let calibrator: SieveCalibrator | null = null;
// The GPU's part in the proofs, made once the sieve (and its proof slots) are loaded.
let stripping: GpuStrippingControl | null = null;
const requestStops = new RequestStops();
// Primes past a(13) proven and checked by this worker, so they aren't proven again.
const provenPrimes = new ProvenPrimeCache();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "pause") {
    requestStops.paused(request.id);
    return;
  }
  requestStops.arrived();
  previousRequest = previousRequest.then(async () => {
    requestStops.started();
    try {
      const { sieve, threads, memoryBudgetBytes, proofSlots } = await sieveReady;
      calibrator ??= new SieveCalibrator(sieve, memoryBudgetBytes);
      stripping ??= new GpuStrippingControl(proofSlots);
      // the list unless the request says it's one prime on its own (/random-prime)
      const work: ProofWork = request.loneProof ? { kind: "lone", bits: request.from.toString(2).length } : { kind: "list" };
      stripping.prepare(request.useGpu ?? false, work, (status) =>
        sendToMainThread({ type: "stripping", id: request.id, generation: request.generation, status }),
      );
      await computeBatch(sieve, request, sendToMainThread, {
        memoryBudgetBytes,
        calibrator,
        threads,
        verify: (primes, rejected, certificates) => verificationPool.verify(primes, rejected, certificates),
        prove: (candidates, options) =>
          proofSlots.proveInOrder(candidates, { ...options, betweenRuns: yieldToMessages }),
        shouldStop: () => requestStops.shouldStop(request.id),
        provenPrimes,
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
