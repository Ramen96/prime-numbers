/// <reference lib="webworker" />
// The prime checker's worker (/is-prime): the single-threaded build only. A
// check is one BPSW run and a proof is one proof slot, so threads would only
// cost memory and start-up, and this way it runs the same in every browser.
// The logic is in primeChecker.ts.

import { GpuStrippingControl } from "./gpuStrippingControl.ts";
import { NumberCheck, type RawNumberCheckExports } from "./numberCheck.ts";
import { PrimeChecker, type PrimeCheckEngine, type PrimeCheckRequest } from "./primeChecker.ts";
import { ProofSlots, type RawProofSlotExports } from "./proofSlots.ts";
import { yieldToMessages } from "./requestStops.ts";

declare const self: DedicatedWorkerGlobalScope;

async function loadEngine(): Promise<PrimeCheckEngine> {
  const { instance } = await WebAssembly.instantiateStreaming(fetch("/sieve.wasm"), {
    // memory growth needs nothing here: NumberCheck and ProofSlots read through a fresh view each time
    env: { emscripten_notify_memory_growth: () => {} },
  });
  (instance.exports._initialize as (() => void) | undefined)?.();
  const proofSlots = new ProofSlots(instance.exports as unknown as RawProofSlotExports);
  return {
    numberCheck: new NumberCheck(instance.exports as unknown as RawNumberCheckExports),
    proofSlots,
    stripping: new GpuStrippingControl(proofSlots),
  };
}

const checker = new PrimeChecker(loadEngine(), (response) => self.postMessage(response), { betweenRuns: yieldToMessages });

self.onmessage = (event: MessageEvent<PrimeCheckRequest>) => {
  void checker.handle(event.data);
};
