// The proof slots (wasm/proof_slots.c) in both shipped builds: candidates past
// a(13) are proven, several at once in the threaded build, and every certificate
// read out of Wasm memory is judged by the independent checker
// (lib/primes/primalityCertificate.ts), which shares no code with the prover.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { checkCertificate, type CertificateStep } from "../../lib/primes/primalityCertificate.ts";
import { THREADED_INITIAL_MEMORY_BYTES } from "../../lib/primes/threadedSieveModule.ts";
import { isPrime, nextPrimeAfter } from "../support/primality.ts";

/** The slot functions, under the same names in both builds. */
interface ProofSlots {
  memory: () => WebAssembly.Memory;
  proof_slot_count(): number;
  proof_input_buffer(limbCount: number): number;
  proof_slot_start(slot: number, limbCount: number): number;
  proof_slots_run(work: number): number;
  proof_slot_state_of(slot: number): number;
  proof_slot_step_count(slot: number): number;
  proof_slot_value(slot: number, step: number, field: number): number;
  proof_output_buffer(): number;
  proof_slot_clear(slot: number): void;
}

const NAMES = [
  "proof_slot_count",
  "proof_input_buffer",
  "proof_slot_start",
  "proof_slots_run",
  "proof_slot_state_of",
  "proof_slot_step_count",
  "proof_slot_value",
  "proof_output_buffer",
  "proof_slot_clear",
] as const;
const DONE = 2;
const A13 = 3_317_044_064_679_887_385_961_981n;

function slotsFrom(exports: Record<string, unknown>, prefix: string, memory: () => WebAssembly.Memory): ProofSlots {
  const slots = { memory } as ProofSlots;
  for (const name of NAMES) (slots as unknown as Record<string, unknown>)[name] = exports[prefix + name];
  return slots;
}

/** Proves every candidate, as many at once as there are slots, and returns the certificates in order. */
function proveAll(slots: ProofSlots, candidates: bigint[]): CertificateStep[][] {
  const count = slots.proof_slot_count();
  const certificates: CertificateStep[][] = [];
  for (let first = 0; first < candidates.length; first += count) {
    const group = candidates.slice(first, first + count);
    group.forEach((candidate, slot) => {
      const limbs: number[] = [];
      for (let rest = candidate; rest > 0n; rest >>= 32n) limbs.push(Number(rest & 0xffffffffn));
      new Uint32Array(slots.memory().buffer, slots.proof_input_buffer(limbs.length) >>> 0, limbs.length).set(limbs);
      assert.equal(slots.proof_slot_start(slot, limbs.length), 1);
    });
    while (slots.proof_slots_run(200) > 0);
    group.forEach((_, slot) => {
      assert.equal(slots.proof_slot_state_of(slot), DONE);
      const value = (step: number, field: number) => {
        const limbCount = slots.proof_slot_value(slot, step, field) >>> 0;
        const limbs = new Uint32Array(slots.memory().buffer, slots.proof_output_buffer() >>> 0, limbCount);
        let result = 0n;
        for (let index = limbCount - 1; index >= 0; index--) result = (result << 32n) | BigInt(limbs[index]);
        return result;
      };
      certificates.push(
        Array.from({ length: slots.proof_slot_step_count(slot) >>> 0 }, (_, step) => ({
          number: value(step, 0),
          curveA: value(step, 1),
          curveB: value(step, 2),
          pointX: value(step, 3),
          pointY: value(step, 4),
          orderPrime: value(step, 5),
        })),
      );
      slots.proof_slot_clear(slot);
    });
  }
  return certificates;
}

/** The first primes past a(13) and at a few larger sizes: what the slots will meet first. */
function candidates(): bigint[] {
  const found: bigint[] = [];
  for (const start of [A13, 10n ** 30n, 10n ** 50n, 10n ** 80n]) {
    let n = start;
    for (let index = 0; index < 5; index++) found.push((n = nextPrimeAfter(n)));
  }
  return found.filter((n) => isPrime(n));
}

describe("proof slots in the shipped builds, judged by the independent checker", () => {
  it("sieve.wasm (one slot)", () => {
    const instance = new WebAssembly.Instance(new WebAssembly.Module(readFileSync("public/sieve.wasm")), {
      env: { emscripten_notify_memory_growth: () => {} },
    });
    (instance.exports._initialize as (() => void) | undefined)?.();
    const memory = instance.exports.memory as WebAssembly.Memory;
    const slots = slotsFrom(instance.exports, "", () => memory);
    assert.equal(slots.proof_slot_count(), 1);
    const all = candidates();
    proveAll(slots, all).forEach((steps, index) => assert.deepEqual(checkCertificate(all[index], steps), { valid: true }));
  });

  it("the threaded build (9 slots, proving at once)", async () => {
    const { default: createSieveModule } = (await import(pathToFileURL("public/sieve-threads/sieve.mjs").href)) as {
      default: (options: { wasmMemory: WebAssembly.Memory; sieveHelperThreads: number }) => Promise<Record<string, unknown>>;
    };
    const wasmMemory = new WebAssembly.Memory({
      initial: THREADED_INITIAL_MEMORY_BYTES / 65_536,
      maximum: 2 ** 32 / 65_536,
      shared: true,
    });
    const sieveModule = await createSieveModule({ wasmMemory, sieveHelperThreads: 8 });
    assert.equal((sieveModule._sieve_start_helpers as (count: number) => number)(8), 8);
    const slots = slotsFrom(sieveModule, "_", () => wasmMemory);
    assert.equal(slots.proof_slot_count(), 9);
    const all = candidates();
    proveAll(slots, all).forEach((steps, index) => assert.deepEqual(checkCertificate(all[index], steps), { valid: true }));
  });
});
