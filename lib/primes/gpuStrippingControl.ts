// The GPU's part in one worker's proofs (CLAUDE.md, step 11d): starts the GPU
// worker (RemoteGpuStripper, which owns the GpuStripper there) the first time a
// request asks for it and the rule says it pays (stripDepth.ts), hands it to the
// proof slots with the rule's line and depths, and tells the page who strips
// (GpuStrippingStatus). Proofs never wait for the GPU worker to start (15 to
// 40 ms, measured on /is-prime): they begin on the CPU, and the GPU takes over
// stripping once it's ready. Once the GPU fails or gives a wrong answer, it's
// never used again in this worker: everything goes on on the CPU, and nothing
// wrong was shown, since every factor and every certificate is checked.

import type { GpuStrippingStatus } from "./protocol.ts";
import type { OrderStripper, ProofSlots, StripperFailure } from "./proofSlots.ts";
import { RemoteGpuStripper } from "./remoteGpuStripper.ts";
import { GPU_STRIPPING_FROM_BITS, gpuStripDepth, gpuStripsFor, type ProofWork } from "./stripDepth.ts";

/**
 * Discriminants per batch each slot hands out. One strip call takes every slot's
 * batch, so with several threads a call has many orders (each discriminant gives
 * up to 6, usually 2), which keeps the GPU's fixed cost per call small.
 */
export const DISCRIMINANTS_PER_BATCH = 8;

/** A stripper that can be thrown away: RemoteGpuStripper, GpuStripper (in the GPU worker), or a stand-in in tests. */
export interface DisposableStripper extends OrderStripper {
  destroy(): void;
}

export class GpuStrippingControl {
  readonly #slots: ProofSlots;
  readonly #create: () => Promise<DisposableStripper | null>;
  /** undefined until the GPU worker has started (or said there's no GPU); null if there's none. */
  #stripper: DisposableStripper | null | undefined = undefined;
  /** Whether the GPU worker has been asked to start (once, the first time a request wants it). */
  #started = false;
  #failure: StripperFailure | null = null;
  #largestPrime: number | null = null;
  #limbStepsPerSecond: number | null = null;
  /** What the request being worked on proves, for the rule. */
  #work: ProofWork = { kind: "list", bits: 0 };
  /** Whether the request being worked on strips on the GPU: it asked, and the rule says it pays. */
  #wanted = false;
  /** Where status changes go: the request being worked on. */
  #send: (status: GpuStrippingStatus) => void = () => {};
  #lastSent = "";

  constructor(slots: ProofSlots, create: () => Promise<DisposableStripper | null> = () => RemoteGpuStripper.create()) {
    this.#slots = slots;
    this.#create = create;
  }

  /**
   * Before a request's proofs: strips them on the GPU if `useGpu`, the rule says
   * it pays for `work` (gpuStripsFor) and the GPU can, otherwise on the CPU. It
   * doesn't wait: the first time, the GPU worker starts meanwhile, and joins
   * these proofs (between two runs) once it's ready, if this request still wants
   * it. `send` gets the status now if it changed, and any change while this
   * request runs.
   */
  prepare(useGpu: boolean, work: ProofWork, send: (status: GpuStrippingStatus) => void): void {
    this.#send = send;
    this.#work = work;
    this.setUseGpu(useGpu);
  }

  /**
   * The visitor switched the GPU on or off (the home page's switch) while a
   * request runs: from the next run of its proofs. Off goes back to the CPU at
   * once, which strips anything still out.
   */
  setUseGpu(useGpu: boolean): void {
    this.#wanted = useGpu && gpuStripsFor(this.#work);
    if (this.#wanted && this.#failure === null && !this.#started) {
      this.#started = true;
      void this.#create()
        .catch(() => null)
        .then((stripper) => {
          this.#stripper = stripper;
          this.#apply();
        });
    }
    this.#apply();
  }

  /** Hands the stripper to the proof slots, or takes it back, as the request being worked on wants. */
  #apply(): void {
    const stripper = this.#stripper;
    if (!this.#wanted || this.#failure !== null || !stripper) {
      if (this.#slots.stripping()) this.#slots.useStripper(null);
    } else if (!this.#slots.stripping()) {
      this.#slots.useStripper({
        stripper,
        discriminantsPerBatch: DISCRIMINANTS_PER_BATCH,
        externalFromBits: GPU_STRIPPING_FROM_BITS,
        largestPrimeFor: gpuStripDepth,
        onStripped: (report) => {
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
