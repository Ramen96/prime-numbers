// The prime checker's worker logic (/is-prime), apart from the worker shell
// (primeCheck.worker.ts) so the Wasm tests can drive it in Node: one request
// at a time, a pause noted at once. "check" settles a number short of a proof
// (settleNumber); "prove" proves a probable prime with a proof slot and checks
// the certificate (answerHolds) before it's sent. Nothing unchecked is sent.

import { answerHolds, type PrimeCheckAnswer } from "../primeCheck.ts";
import { digitsOfBitLength, PROGRESS_INTERVAL_MS } from "./computeBatch.ts";
import { settleNumber, type NumberCheck } from "./numberCheck.ts";
import type { GpuStrippingControl } from "./gpuStrippingControl.ts";
import type { GpuStrippingStatus } from "./protocol.ts";
import type { ProofSlots } from "./proofSlots.ts";

export type PrimeCheckRequest =
  | { type: "check"; id: number; value: bigint }
  /** Prove a number "check" found probably prime. It's checked again first: a proof slot only takes a BPSW pass. */
  | { type: "prove"; id: number; value: bigint; useGpu?: boolean }
  /** Stop proving request `id`, keeping its chain: a later "prove" of the same number resumes it. */
  | { type: "pause"; id: number };

export type PrimeCheckResponse =
  /** `elapsedMs`: time spent on it, a proof's across pauses included. */
  | { type: "answer"; id: number; answer: PrimeCheckAnswer; elapsedMs: number }
  | { type: "proving-progress"; id: number; elapsedMs: number; digits: number; reachedDigits: number }
  /** Who strips curve orders for the proof (step 11d), when it changes. */
  | { type: "stripping"; id: number; status: GpuStrippingStatus }
  | { type: "paused"; id: number }
  /** Memory ran out: nothing is settled. */
  | { type: "memory-limit"; id: number }
  /**
   * The engine's answer, or the certificate the prover made, didn't hold when
   * checked again: nothing about the number is shown. `claimed` is what it said, if anything.
   */
  | { type: "disputed"; id: number; value: bigint; stage: "check" | "proof"; claimed: PrimeCheckAnswer | null }
  | { type: "error"; id: number; message: string };

export interface PrimeCheckEngine {
  numberCheck: NumberCheck;
  proofSlots: ProofSlots;
  /** The GPU's part in proofs; without it, the CPU strips. */
  stripping?: GpuStrippingControl;
}

export interface PrimeCheckerOptions {
  /** Awaited between proving runs: where the worker takes in a pause. */
  betweenRuns?: () => void | Promise<void>;
  now?: () => number;
  /** Work units per proving run (ProofSlots' default if not given). */
  workPerRun?: number;
}

export class PrimeChecker {
  readonly #engine: Promise<PrimeCheckEngine>;
  readonly #send: (response: PrimeCheckResponse) => void;
  readonly #options: PrimeCheckerOptions;
  readonly #now: () => number;
  #previousRequest: Promise<void> = Promise.resolve();
  /** Every request up to this id was paused. */
  #pausedUpToId = 0;
  /** Proving time so far for the number whose chain the slot keeps, across pauses. */
  #provingTime: { value: bigint; elapsedMs: number } | null = null;

  constructor(engine: Promise<PrimeCheckEngine>, send: (response: PrimeCheckResponse) => void, options: PrimeCheckerOptions = {}) {
    this.#engine = engine;
    engine.catch(() => {}); // a failed load is reported to each request (handle), not as an unhandled rejection
    this.#send = send;
    this.#options = options;
    this.#now = options.now ?? (() => performance.now());
  }

  /** Takes a request: a pause at once, the rest one at a time, in order. Resolves once it's answered. */
  handle(request: PrimeCheckRequest): Promise<void> {
    if (request.type === "pause") {
      this.#pausedUpToId = Math.max(this.#pausedUpToId, request.id);
      return Promise.resolve();
    }
    this.#previousRequest = this.#previousRequest.then(async () => {
      try {
        const engine = await this.#engine;
        if (request.type === "check") this.#check(engine, request.id, request.value);
        else await this.#prove(engine, request.id, request.value, request.useGpu ?? false);
      } catch (error) {
        this.#send({ type: "error", id: request.id, message: error instanceof Error ? error.message : String(error) });
      }
    });
    return this.#previousRequest;
  }

  #check(engine: PrimeCheckEngine, id: number, value: bigint): void {
    const started = this.#now();
    const settled = settleNumber(value, engine.numberCheck);
    if (settled.settled) this.#send({ type: "answer", id, answer: settled.answer, elapsedMs: this.#now() - started });
    else if (settled.reason === "out-of-memory") this.#send({ type: "memory-limit", id });
    else this.#send({ type: "disputed", id, value, stage: "check", claimed: settled.answer });
  }

  async #prove(engine: PrimeCheckEngine, id: number, value: bigint, useGpu: boolean): Promise<void> {
    const started = this.#now();
    const settled = settleNumber(value, engine.numberCheck);
    if (!settled.settled) {
      if (settled.reason === "out-of-memory") this.#send({ type: "memory-limit", id });
      else this.#send({ type: "disputed", id, value, stage: "check", claimed: settled.answer });
      return;
    }
    if (settled.answer.kind !== "probably-prime") {
      // nothing to prove: already settled (a proof slot would never finish a composite)
      this.#send({ type: "answer", id, answer: settled.answer, elapsedMs: this.#now() - started });
      return;
    }
    if (this.#provingTime?.value !== value) this.#provingTime = { value, elapsedMs: 0 };
    const elapsedBefore = this.#provingTime.elapsedMs;
    const elapsed = () => elapsedBefore + this.#now() - started;
    const digits = value.toString().length;
    let lastProgress = -Infinity;
    await engine.stripping?.prepare(useGpu, (status) => this.#send({ type: "stripping", id, status }));
    const proven = await engine.proofSlots.proveInOrder([value], {
      workPerRun: this.#options.workPerRun,
      betweenRuns: this.#options.betweenRuns,
      shouldStop: () => id <= this.#pausedUpToId,
      onProgress: (_, reachedBits) => {
        const time = this.#now();
        if (time - lastProgress < PROGRESS_INTERVAL_MS) return;
        lastProgress = time;
        const reachedDigits = Math.min(digits, digitsOfBitLength(reachedBits));
        this.#send({ type: "proving-progress", id, elapsedMs: elapsed(), digits, reachedDigits });
      },
    });
    this.#provingTime.elapsedMs = elapsed();
    if (proven.stopped) {
      this.#send({ type: "paused", id });
      return;
    }
    this.#provingTime = null;
    if (proven.outOfMemory) {
      this.#send({ type: "memory-limit", id });
      return;
    }
    const answer: PrimeCheckAnswer = { kind: "prime", value, proof: { by: "certificate", steps: proven.certificates[0] } };
    if (answerHolds(answer)) this.#send({ type: "answer", id, answer, elapsedMs: elapsed() });
    else this.#send({ type: "disputed", id, value, stage: "proof", claimed: answer });
  }
}
