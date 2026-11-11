// The proof slots (wasm/proof_slots.c) as the worker sees them: one ECPP prover
// per sieve thread, given candidates past a(13) and run a bounded amount at a
// time, with every value crossing the Wasm boundary as limbs (Requirement B).
// The certificates still have to be checked (primalityCertificate.ts) before a
// prime is shown; nothing here is trusted for correctness.

import type { CertificateStep } from "./primalityCertificate.ts";
import { fromLimbs, toLimbs, unsigned32 } from "./wasmSieve.ts";

/** The slot functions, as both builds export them (the threaded one through threadedSieveModule.ts). */
export interface RawProofSlotExports {
  memory: WebAssembly.Memory;
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

/** proof_slot_state in proof_slots.h. */
const SLOT_DONE = 2;
const SLOT_OUT_OF_MEMORY = 3;
/** proof_slot_value's SIZE_MAX in wasm32: memory ran out copying the value. */
const VALUE_OUT_OF_MEMORY = 0xffff_ffff;

/**
 * Work units per run before control comes back to JavaScript (a unit is one
 * discriminant examined or one curve built). Small enough that the worker can
 * take in a newer request between runs; large enough that waking the threads
 * is a small part of the time.
 */
export const DEFAULT_WORK_PER_RUN = 64;

export interface ProveOptions {
  workPerRun?: number;
  /** Called between runs, and awaited: the place to let the worker take messages. */
  betweenRuns?: () => void | Promise<void>;
}

export interface ProvenInOrder {
  /** Certificates for the first candidates, in order: every one, unless memory ran out. */
  certificates: CertificateStep[][];
  /** Memory ran out on candidate number certificates.length; it and everything after stay pending. */
  outOfMemory: boolean;
}

/** One candidate's certificate fields, in proof_slot_value's order. */
const FIELDS = ["number", "curveA", "curveB", "pointX", "pointY", "orderPrime"] as const;

export class ProofSlots {
  readonly #raw: RawProofSlotExports;

  constructor(raw: RawProofSlotExports) {
    this.#raw = raw;
  }

  /** One slot per thread; 0 if memory ran out setting them up. */
  slotCount(): number {
    return this.#raw.proof_slot_count();
  }

  /**
   * Proves `candidates` (each past a(13), a BPSW pass), as many at once as there
   * are slots, keeping every slot busy, and returns their certificates in order.
   */
  async proveInOrder(candidates: readonly bigint[], options: ProveOptions = {}): Promise<ProvenInOrder> {
    const workPerRun = options.workPerRun ?? DEFAULT_WORK_PER_RUN;
    const slotCount = this.slotCount();
    if (slotCount === 0) return { certificates: [], outOfMemory: candidates.length > 0 };

    const certificates: (CertificateStep[] | undefined)[] = new Array(candidates.length);
    const candidateInSlot: (number | null)[] = new Array(slotCount).fill(null);
    let nextCandidate = 0;
    // the first candidate memory ran out on: nothing from there on is started or kept
    let firstOutOfMemory = candidates.length;

    const busy = () => candidateInSlot.some((index) => index !== null);
    for (;;) {
      for (let slot = 0; slot < slotCount; slot++) {
        if (candidateInSlot[slot] !== null || nextCandidate >= firstOutOfMemory) continue;
        if (this.#start(slot, candidates[nextCandidate])) candidateInSlot[slot] = nextCandidate++;
        else firstOutOfMemory = nextCandidate;
      }
      if (!busy()) break;

      this.#raw.proof_slots_run(workPerRun);
      for (let slot = 0; slot < slotCount; slot++) {
        const index = candidateInSlot[slot];
        if (index === null) continue;
        const state = this.#raw.proof_slot_state_of(slot);
        if (state === SLOT_DONE) {
          const certificate = this.#readCertificate(slot);
          if (certificate === null) firstOutOfMemory = Math.min(firstOutOfMemory, index);
          else certificates[index] = certificate;
        } else if (state === SLOT_OUT_OF_MEMORY) {
          firstOutOfMemory = Math.min(firstOutOfMemory, index);
        } else {
          continue; // still proving
        }
        this.#raw.proof_slot_clear(slot);
        candidateInSlot[slot] = null;
      }
      // a slot proving a candidate past the one memory ran out on is wasted work: free it
      for (let slot = 0; slot < slotCount; slot++) {
        const index = candidateInSlot[slot];
        if (index !== null && index > firstOutOfMemory) {
          this.#raw.proof_slot_clear(slot);
          candidateInSlot[slot] = null;
        }
      }
      await options.betweenRuns?.();
    }

    const proven: CertificateStep[][] = [];
    for (let index = 0; index < firstOutOfMemory; index++) proven.push(certificates[index]!);
    return { certificates: proven, outOfMemory: firstOutOfMemory < candidates.length };
  }

  /** Writes the candidate's limbs and starts its slot. False if memory ran out. */
  #start(slot: number, candidate: bigint): boolean {
    const raw = this.#raw;
    const limbs = toLimbs(candidate);
    const pointer = unsigned32(raw.proof_input_buffer(limbs.length));
    if (pointer === 0) return false;
    // A fresh view after every call: memory growth detaches old ones.
    new Uint32Array(raw.memory.buffer, pointer, limbs.length).set(limbs);
    return raw.proof_slot_start(slot, limbs.length) === 1;
  }

  /** A finished slot's certificate, rebuilt exactly; null if memory ran out reading it. */
  #readCertificate(slot: number): CertificateStep[] | null {
    const raw = this.#raw;
    const stepCount = unsigned32(raw.proof_slot_step_count(slot));
    const steps: CertificateStep[] = [];
    for (let step = 0; step < stepCount; step++) {
      const values: Partial<Record<(typeof FIELDS)[number], bigint>> = {};
      for (let field = 0; field < FIELDS.length; field++) {
        const limbCount = unsigned32(raw.proof_slot_value(slot, step, field));
        if (limbCount === VALUE_OUT_OF_MEMORY) return null;
        values[FIELDS[field]] = fromLimbs(new Uint32Array(raw.memory.buffer, unsigned32(raw.proof_output_buffer()), limbCount));
      }
      steps.push(values as CertificateStep);
    }
    return steps;
  }
}
