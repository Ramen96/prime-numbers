// The proof slots (wasm/proof_slots.c) in both shipped builds, through the
// worker's own wrapper (lib/primes/proofSlots.ts): candidates past a(13) are
// proven, several at once in the threaded build, and every certificate read out
// of Wasm memory is judged by the independent checker
// (lib/primes/primalityCertificate.ts), which shares no code with the prover.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { checkCertificate } from "../../lib/primes/primalityCertificate.ts";
import { ProofSlots, type RawProofSlotExports } from "../../lib/primes/proofSlots.ts";
import {
  rawProofSlotExportsOf,
  THREADED_INITIAL_MEMORY_BYTES,
  type CreateSieveModule,
} from "../../lib/primes/threadedSieveModule.ts";
import { isPrime, nextPrimeAfter } from "../support/primality.ts";

/** The first primes past a(13) and at a few larger sizes: what the slots will meet first. */
function candidates(): bigint[] {
  const found: bigint[] = [];
  for (const start of [A13, 10n ** 30n, 10n ** 50n, 10n ** 80n]) {
    let n = start;
    for (let index = 0; index < 5; index++) found.push((n = nextPrimeAfter(n)));
  }
  return found.filter((n) => isPrime(n));
}

const A13 = 3_317_044_064_679_887_385_961_981n;

describe("proof slots in the shipped builds, judged by the independent checker", () => {
  it("sieve.wasm (one slot)", async () => {
    const instance = new WebAssembly.Instance(new WebAssembly.Module(readFileSync("public/sieve.wasm")), {
      env: { emscripten_notify_memory_growth: () => {} },
    });
    (instance.exports._initialize as (() => void) | undefined)?.();
    const slots = new ProofSlots(instance.exports as unknown as RawProofSlotExports);
    assert.equal(slots.slotCount(), 1);
    const all = candidates();
    const { certificates, outOfMemory } = await slots.proveInOrder(all);
    assert.equal(outOfMemory, false);
    assert.equal(certificates.length, all.length);
    certificates.forEach((steps, index) => assert.deepEqual(checkCertificate(all[index], steps), { valid: true }));
  });

  it("the threaded build (9 slots, proving at once)", async () => {
    const { default: createSieveModule } = (await import(pathToFileURL("public/sieve-threads/sieve.mjs").href)) as {
      default: CreateSieveModule;
    };
    const wasmMemory = new WebAssembly.Memory({
      initial: THREADED_INITIAL_MEMORY_BYTES / 65_536,
      maximum: 2 ** 32 / 65_536,
      shared: true,
    });
    const sieveModule = await createSieveModule({ wasmMemory, sieveHelperThreads: 8 });
    assert.equal(sieveModule._sieve_start_helpers(8), 8);
    const slots = new ProofSlots(rawProofSlotExportsOf(sieveModule));
    assert.equal(slots.slotCount(), 9);
    const all = candidates();
    const { certificates, outOfMemory } = await slots.proveInOrder(all, { workPerRun: 16 });
    assert.equal(outOfMemory, false);
    assert.equal(certificates.length, all.length);
    certificates.forEach((steps, index) => assert.deepEqual(checkCertificate(all[index], steps), { valid: true }));
  });
});
