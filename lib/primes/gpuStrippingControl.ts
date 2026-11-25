// The GPU's part in one worker's proofs (CLAUDE.md, step 11d): makes the
// GpuStripper the first time a request asks for it, hands it to the proof slots
// with the depth controller (stripBound.ts), and tells the page who strips
// (GpuStrippingStatus). Once the GPU fails or gives a wrong answer, it's never
// used again in this worker: everything goes on on the CPU, and nothing wrong
// was shown, since every factor and every certificate is checked.

import { GpuStripper } from "./gpuStripping.ts";
import type { GpuStrippingStatus } from "./protocol.ts";
import type { OrderStripper, ProofSlots, StripperFailure } from "./proofSlots.ts";
import { StripBound } from "./stripBound.ts";

/**
 * Discriminants per batch each slot hands out. One strip call takes every slot's
 * batch, so with several threads a call has many orders (each discriminant gives
 * up to 6, usually 2), which keeps the GPU's fixed cost per call small.
 */
export const DISCRIMINANTS_PER_BATCH = 8;

/**
 * Numbers below this strip on the CPU, since for them the GPU's overhead costs more
 * than it saves: 246 bits, 75 digits (step 11d, M1: the CPU won every node below 75
 * digits, the GPU every band from 100). Interim, until the rule from the measurements
 * (part 3) replaces StripBound.
 */
export const EXTERNAL_FROM_BITS = 246;

/** A stripper that can be thrown away: GpuStripper, or a stand-in in tests. */
export interface DisposableStripper extends OrderStripper {
  destroy(): void;
}

export class GpuStrippingControl {
  readonly #slots: ProofSlots;
  readonly #create: () => Promise<DisposableStripper | null>;
  /** undefined until a request first asks for the GPU; null if there's none. */
  #stripper: DisposableStripper | null | undefined = undefined;
  #failure: StripperFailure | null = null;
  readonly #bound = new StripBound();
  #largestPrime: number | null = null;
  #limbStepsPerSecond: number | null = null;
  /** What the request being worked on asked for. */
  #wanted = false;
  /** Where status changes go: the request being worked on. */
  #send: (status: GpuStrippingStatus) => void = () => {};
  #lastSent = "";

  constructor(slots: ProofSlots, create: () => Promise<DisposableStripper | null> = () => GpuStripper.create()) {
    this.#slots = slots;
    this.#create = create;
  }

  /**
   * Before a request's proofs: strips them on the GPU if `useGpu` and it can,
   * otherwise on the CPU. `send` gets the status now if it changed, and any
   * change while this request runs.
   */
  async prepare(useGpu: boolean, send: (status: GpuStrippingStatus) => void): Promise<void> {
    this.#send = send;
    this.#wanted = useGpu;
    if (useGpu && this.#failure === null && this.#stripper === undefined) {
      try {
        this.#stripper = await this.#create();
      } catch {
        this.#stripper = null;
      }
    }
    const stripper = this.#stripper;
    if (!useGpu || this.#failure !== null || !stripper) {
      if (this.#slots.stripping()) this.#slots.useStripper(null);
    } else if (!this.#slots.stripping()) {
      this.#slots.useStripper({
        stripper,
        discriminantsPerBatch: DISCRIMINANTS_PER_BATCH,
        externalFromBits: EXTERNAL_FROM_BITS,
        largestPrimeFor: (limbs) => this.#bound.largestPrimeFor(limbs),
        onStripped: (report) => {
          this.#bound.record(report);
          this.#largestPrime = report.largestPrime;
          this.#limbStepsPerSecond = (report.orderCount * report.limbs * countOfPrimesUpTo(report.largestPrime)) / (Math.max(report.stripMs, 1) / 1000);
          this.#sendStatus();
        },
        onFailure: (failure) => {
          this.#failure = failure;
          stripper.destroy();
          this.#stripper = null;
          this.#sendStatus();
        },
      });
    }
    this.#sendStatus();
  }

  status(): GpuStrippingStatus {
    if (this.#failure !== null) return { state: "failed", failure: this.#failure };
    if (!this.#wanted || this.#stripper === undefined) return { state: "cpu" };
    if (this.#stripper === null) return { state: "unavailable" };
    return { state: "gpu", largestPrime: this.#largestPrime, limbStepsPerSecond: this.#limbStepsPerSecond };
  }

  /** Sends the status if it changed (the depth, not every new rate measurement). */
  #sendStatus(): void {
    const status = this.status();
    const key = JSON.stringify({ ...status, limbStepsPerSecond: undefined });
    if (key === this.#lastSent) return;
    this.#lastSent = key;
    this.#send(status);
  }
}

/** About how many primes there are up to x (x / ln x, within 13% from 10^5 up): only for the rate shown. */
function countOfPrimesUpTo(x: number): number {
  return x / Math.log(x);
}
