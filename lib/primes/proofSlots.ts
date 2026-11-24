// The proof slots (wasm/proof_slots.c) as the worker sees them: one ECPP prover
// per sieve thread, given candidates past a(13) and run a bounded amount at a
// time, with every value crossing the Wasm boundary as limbs (Requirement B).
// The certificates still have to be checked (primalityCertificate.ts) before a
// prime is shown; nothing here is trusted for correctness.

import type { StripHit } from "./gpuStripping.ts";
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
  /** The bit length of the number the slot's chain has reached; 0 unless it's proving. */
  proof_slot_progress(slot: number): number;
  // External stripping (step 11d): the GPU finds the small factors of curve orders.
  proof_slots_set_external_stripping(discriminantsPerBatch: number): void;
  proof_slot_strip_batch(slot: number): number;
  proof_slot_strip_request_count(slot: number): number;
  proof_slot_strip_request(slot: number, index: number): number;
  proof_slot_report_factors(slot: number, batch: number, pairCount: number): number;
  proof_slot_rejected_claims(slot: number): number;
}

/**
 * Something that finds the small prime factors of curve orders: the GPU
 * (GpuStripper, gpuStripping.ts), or a stand-in in tests. Nothing it says is
 * trusted: every factor is checked by the prover, and a sample of orders is
 * checked here (STRIP_SPOT_CHECK_EVERY).
 */
export interface OrderStripper {
  strip(orders: readonly Uint32Array[], largestPrime: number, signal?: AbortSignal): Promise<StripHit[]>;
}

/** Why the stripper was dropped, for the worker to tell the page (it stays on the CPU from then on). */
export type StripperFailure =
  | { kind: "error"; message: string } // the GPU failed (GpuStrippingError, or anything else it threw)
  | { kind: "wrong-factor" } // it reported a factor that doesn't divide its order
  | { kind: "missed-factor"; prime: number }; // a spot check found a small factor it didn't report

/** One strip call, for the depth controller (step 11d, part 3). */
export interface StripReport {
  orderCount: number;
  /** The largest limb count among the orders (they're padded to it on the GPU). */
  limbs: number;
  largestPrime: number;
  /** From sending the batches to having the answers. */
  stripMs: number;
  /** How long, of that, every busy slot was waiting with nothing to do. */
  waitedMs: number;
}

export interface StrippingSetup {
  stripper: OrderStripper;
  /** Discriminants per batch a slot hands out (proof_slots_set_external_stripping). */
  discriminantsPerBatch: number;
  /** How deep to strip, given the largest order's limb count in a call. */
  largestPrimeFor: (limbs: number) => number;
  /** The stripper was dropped: every slot is back on the CPU, which strips anything still out. */
  onFailure?: (failure: StripperFailure) => void;
  onStripped?: (report: StripReport) => void;
  /** One order in this many is trial-divided here to check the stripper missed nothing small (tests set 1). */
  spotCheckEvery?: number;
}

/**
 * A missed factor only slows a proof, so nothing else would ever notice one: one
 * order in this many is trial-divided on the CPU up to STRIP_SPOT_CHECK_BOUND and
 * compared with what the stripper reported.
 */
export const STRIP_SPOT_CHECK_EVERY = 64;
/** The spot check's trial division: up to here (1,229 primes), a few microseconds an order. */
export const STRIP_SPOT_CHECK_BOUND = 10_000;
const SPOT_CHECK_PRIMES: readonly number[] = (() => {
  const composite = new Uint8Array(STRIP_SPOT_CHECK_BOUND + 1);
  const primes: number[] = [];
  for (let candidate = 2; candidate <= STRIP_SPOT_CHECK_BOUND; candidate++) {
    if (composite[candidate]) continue;
    primes.push(candidate);
    for (let multiple = candidate * candidate; multiple <= STRIP_SPOT_CHECK_BOUND; multiple += candidate) composite[multiple] = 1;
  }
  return primes;
})();

/** One strip call on its way: which slot's batch each order came from, and how to call it off. */
interface StripInFlight {
  done: Promise<void>;
  abort: AbortController;
}

/** proof_slot_state in proof_slots.h. */
const SLOT_DONE = 2;
const SLOT_OUT_OF_MEMORY = 3;
const SLOT_WAITING = 4;
/**
 * proof_slot_value's SIZE_MAX in wasm32: memory ran out copying the value. Never a
 * real limb count: 2^32 − 1 limbs would be 16 GiB, and wasm32 addresses 4 GiB.
 */
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
  /**
   * Asked after each run: true to stop there (Stop, or a newer request). Nothing
   * is lost: unfinished chains stay in their slots and finished certificates are
   * kept, for a later call that asks for the same candidates.
   */
  shouldStop?: () => boolean;
  /**
   * Called for each candidate, in order, as soon as it and every candidate
   * before it have certificates: for showing primes as they're proven
   * (streaming) instead of when the whole batch is. A certificate given here
   * isn't kept if the call stops, since its prime was already taken.
   */
  onProven?: (index: number, certificate: CertificateStep[]) => void;
  /**
   * Called after each run with how far the chain has got for the candidate
   * everything waits on (the first not yet given to onProven): the bit length
   * of the number it has reached (proof_slot_progress). Not called while that
   * candidate's certificate is in hand, nor once memory has run out on it.
   */
  onProgress?: (index: number, reachedBits: number) => void;
}

export interface ProvenInOrder {
  /** Certificates for the first candidates, in order: every one, unless memory ran out or it stopped. */
  certificates: CertificateStep[][];
  /** Memory ran out on candidate number certificates.length; it and everything after stay pending. */
  outOfMemory: boolean;
  /** shouldStop said to stop: no certificates are returned, and everything is kept for later. */
  stopped: boolean;
}

/** One candidate's certificate fields, in proof_slot_value's order. */
const FIELDS = ["number", "curveA", "curveB", "pointX", "pointY", "orderPrime"] as const;

export class ProofSlots {
  readonly #raw: RawProofSlotExports;
  /** The candidate each slot holds (proving, or done and not yet read), or null if it's idle. */
  readonly #candidateInSlot: (bigint | null)[] = [];
  /** Certificates finished during a call that stopped, waiting for a call that asks for them. */
  #keptCertificates = new Map<bigint, CertificateStep[]>();
  /** External stripping, while it's on. */
  #stripping: StrippingSetup | null = null;
  /** The strip call on its way, if any (one at a time: batches that come out meanwhile go in the next). */
  #inFlight: StripInFlight | null = null;
  /** Per slot, the batch number sent in the call on its way (0: none), so it isn't sent twice. */
  #sentBatch: number[] = [];
  /** Rejected claims across every slot when stripping started: any more means a wrong factor. */
  #rejectedClaimsBefore = 0;
  /** Orders stripped so far, for picking the spot-checked ones. */
  #ordersStripped = 0;
  /** Since the call on its way was sent, how long every busy slot has waited for it (up to #waitingSince). */
  #waitedMs = 0;
  /** When every busy slot started waiting for the call on its way, while they are; null otherwise. */
  #waitingSince: number | null = null;

  constructor(raw: RawProofSlotExports) {
    this.#raw = raw;
  }

  /** One slot per thread; 0 if memory ran out setting them up. */
  slotCount(): number {
    return this.#raw.proof_slot_count();
  }

  /**
   * Strips curve orders with `setup.stripper` from now on (the GPU), or, with
   * null, on the CPU again: anything handed out and not yet answered is stripped
   * there at the next run, and an answer still on its way is ignored.
   */
  useStripper(setup: StrippingSetup | null): void {
    this.#abortInFlight();
    this.#stripping = setup;
    this.#raw.proof_slots_set_external_stripping(setup ? setup.discriminantsPerBatch : 0);
    this.#rejectedClaimsBefore = this.#rejectedClaims();
  }

  /** Whether a stripper is in use (it's dropped after a failure or a wrong answer). */
  stripping(): boolean {
    return this.#stripping !== null;
  }

  /**
   * Proves `candidates` (each past a(13), a BPSW pass), as many at once as there
   * are slots, keeping every slot busy, and returns their certificates in order.
   *
   * Work from an earlier call that stopped carries over: a slot still holding
   * one of these candidates goes on with its chain, and a certificate kept from
   * then is used as it is. Work for any other candidate is dropped first, since
   * its slot is needed.
   */
  async proveInOrder(candidates: readonly bigint[], options: ProveOptions = {}): Promise<ProvenInOrder> {
    const workPerRun = options.workPerRun ?? DEFAULT_WORK_PER_RUN;
    const slotCount = this.slotCount();
    if (slotCount === 0) return { certificates: [], outOfMemory: candidates.length > 0, stopped: false };

    const indexOf = new Map(candidates.map((candidate, index) => [candidate, index]));
    const certificates: (CertificateStep[] | undefined)[] = candidates.map((candidate) =>
      this.#keptCertificates.get(candidate),
    );
    this.#keptCertificates = new Map();
    const indexInSlot: (number | null)[] = new Array(slotCount).fill(null);
    for (let slot = 0; slot < slotCount; slot++) {
      const held = this.#candidateInSlot[slot] ?? null;
      if (held === null) continue;
      const index = indexOf.get(held);
      if (index === undefined || certificates[index] !== undefined) this.#clear(slot);
      else indexInSlot[slot] = index;
    }
    const isStarted = (index: number) => certificates[index] !== undefined || indexInSlot.includes(index);
    let nextCandidate = 0;
    // the first candidate memory ran out on: nothing from there on is started or kept
    let firstOutOfMemory = candidates.length;
    // candidates before this were given to onProven
    let reported = 0;
    const reportInOrder = () => {
      while (reported < firstOutOfMemory && certificates[reported] !== undefined) {
        options.onProven?.(reported, certificates[reported]!);
        reported++;
      }
    };
    reportInOrder(); // certificates kept from a call that stopped

    for (;;) {
      for (let slot = 0; slot < slotCount; slot++) {
        if (indexInSlot[slot] !== null) continue;
        while (nextCandidate < firstOutOfMemory && isStarted(nextCandidate)) nextCandidate++;
        if (nextCandidate >= firstOutOfMemory) break;
        if (this.#start(slot, candidates[nextCandidate])) indexInSlot[slot] = nextCandidate++;
        else firstOutOfMemory = nextCandidate;
      }
      if (!indexInSlot.some((index) => index !== null)) break;

      this.#raw.proof_slots_run(workPerRun);
      for (let slot = 0; slot < slotCount; slot++) {
        const index = indexInSlot[slot];
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
        this.#clear(slot);
        indexInSlot[slot] = null;
      }
      // a slot proving a candidate past the one memory ran out on is wasted work: free it
      for (let slot = 0; slot < slotCount; slot++) {
        const index = indexInSlot[slot];
        if (index !== null && index > firstOutOfMemory) {
          this.#clear(slot);
          indexInSlot[slot] = null;
        }
      }
      reportInOrder();
      if (this.#stripping) await this.#keepStripping(indexInSlot);
      if (options.onProgress && reported < firstOutOfMemory) {
        const slot = indexInSlot.indexOf(reported);
        if (slot !== -1) options.onProgress(reported, this.#raw.proof_slot_progress(slot) >>> 0);
      }
      await options.betweenRuns?.();
      if (firstOutOfMemory === candidates.length && options.shouldStop?.()) {
        candidates.forEach((candidate, index) => {
          const certificate = certificates[index];
          if (certificate !== undefined && index >= reported) this.#keptCertificates.set(candidate, certificate);
        });
        this.#abortInFlight(); // the batches stay out: they're sent again when this resumes
        return { certificates: [], outOfMemory: false, stopped: true };
      }
    }

    this.#abortInFlight(); // anything still on its way is for slots no longer needed
    reportInOrder();
    const proven: CertificateStep[][] = [];
    for (let index = 0; index < firstOutOfMemory; index++) proven.push(certificates[index]!);
    return { certificates: proven, outOfMemory: firstOutOfMemory < candidates.length, stopped: false };
  }

  /**
   * After a run, with a stripper: sends every batch that isn't on its way yet (if
   * no call is), and if every busy slot is waiting for its batch, waits for the
   * answers instead of running the threads for nothing.
   */
  async #keepStripping(indexInSlot: readonly (number | null)[]): Promise<void> {
    if (this.#inFlight === null) this.#sendBatches();
    const busy = indexInSlot.flatMap((index, slot) => (index === null ? [] : [slot]));
    const inFlight = this.#inFlight;
    if (inFlight && busy.length > 0 && busy.every((slot) => this.#raw.proof_slot_state_of(slot) === SLOT_WAITING)) {
      this.#waitingSince = performance.now();
      try {
        await inFlight.done;
      } finally {
        this.#stopWaiting();
      }
    }
  }

  /** Adds the wait so far to #waitedMs (the answer's handler does this too, since it runs first). */
  #stopWaiting(): void {
    if (this.#waitingSince === null) return;
    this.#waitedMs += performance.now() - this.#waitingSince;
    this.#waitingSince = null;
  }

  /** Every slot's batch that's out and not yet sent, in one strip call, not awaited. */
  #sendBatches(): void {
    const setup = this.#stripping;
    if (!setup) return;
    const raw = this.#raw;
    const orders: Uint32Array[] = [];
    // for each order: which slot, and its request index there
    const origins: { slot: number; request: number }[] = [];
    const batches: { slot: number; batch: number }[] = [];
    for (let slot = 0; slot < this.slotCount(); slot++) {
      const batch = unsigned32(raw.proof_slot_strip_batch(slot));
      if (batch === 0 || this.#sentBatch[slot] === batch) continue;
      const requestCount = unsigned32(raw.proof_slot_strip_request_count(slot));
      const slotOrders: Uint32Array[] = [];
      for (let request = 0; request < requestCount; request++) {
        const limbCount = unsigned32(raw.proof_slot_strip_request(slot, request));
        if (limbCount === 0 || limbCount === VALUE_OUT_OF_MEMORY) break; // try this slot again next time
        slotOrders.push(new Uint32Array(raw.memory.buffer, unsigned32(raw.proof_output_buffer()), limbCount).slice());
      }
      if (slotOrders.length < requestCount) continue;
      slotOrders.forEach((order, request) => {
        orders.push(order);
        origins.push({ slot, request });
      });
      batches.push({ slot, batch });
    }
    if (batches.length === 0) return;
    for (const { slot, batch } of batches) this.#sentBatch[slot] = batch;
    const limbs = Math.max(...orders.map((order) => order.length));
    const largestPrime = setup.largestPrimeFor(limbs);
    const abort = new AbortController();
    const began = performance.now();
    this.#waitedMs = 0;
    const done = setup.stripper.strip(orders, largestPrime, abort.signal).then(
      (hits) => {
        if (abort.signal.aborted || this.#stripping !== setup) return;
        this.#stopWaiting();
        this.#inFlight = null;
        for (const { slot } of batches) this.#sentBatch[slot] = 0;
        const failure = this.#answer(orders, origins, batches, hits, largestPrime);
        if (failure) {
          this.#dropStripper(failure);
          return;
        }
        setup.onStripped?.({ orderCount: orders.length, limbs, largestPrime, stripMs: performance.now() - began, waitedMs: this.#waitedMs });
      },
      (error: unknown) => {
        if (abort.signal.aborted || this.#stripping !== setup) return;
        this.#inFlight = null;
        for (const { slot } of batches) this.#sentBatch[slot] = 0;
        this.#dropStripper({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      },
    );
    this.#inFlight = { done, abort };
  }

  /**
   * Reports each slot's factors (the prover checks every one), then checks the
   * answer: no claim rejected, and the spot-checked orders' small factors all
   * found. Returns why the stripper can't be trusted, or null.
   */
  #answer(
    orders: readonly Uint32Array[],
    origins: readonly { slot: number; request: number }[],
    batches: readonly { slot: number; batch: number }[],
    hits: readonly StripHit[],
    largestPrime: number,
  ): StripperFailure | null {
    const raw = this.#raw;
    const pairsFor = new Map<number, number[]>(batches.map(({ slot }) => [slot, []]));
    for (const { order, prime } of hits) {
      const origin = origins[order];
      // a hit for an order that wasn't asked about, or with a prime past 32 bits, is a claim that can't be true
      if (origin === undefined || !Number.isInteger(prime) || prime < 2 || prime > 0xffff_ffff) return { kind: "wrong-factor" };
      pairsFor.get(origin.slot)!.push(origin.request, prime);
    }
    for (const { slot, batch } of batches) {
      const pairs = pairsFor.get(slot)!;
      const pointer = unsigned32(raw.proof_input_buffer(Math.max(pairs.length, 1)));
      if (pointer === 0) continue; // memory ran out: the batch is still out, and is sent again
      new Uint32Array(raw.memory.buffer, pointer, pairs.length).set(pairs);
      raw.proof_slot_report_factors(slot, batch, pairs.length / 2);
    }
    if (this.#rejectedClaims() > this.#rejectedClaimsBefore) return { kind: "wrong-factor" };

    const every = this.#stripping?.spotCheckEvery ?? STRIP_SPOT_CHECK_EVERY;
    const found = new Set(hits.map(({ order, prime }) => `${order}:${prime}`));
    for (let order = 0; order < orders.length; order++) {
      if (this.#ordersStripped++ % every !== 0) continue;
      const value = fromLimbs(orders[order]);
      for (const prime of SPOT_CHECK_PRIMES) {
        if (prime > largestPrime) break;
        if (value % BigInt(prime) === 0n && !found.has(`${order}:${prime}`)) return { kind: "missed-factor", prime };
      }
    }
    return null;
  }

  /** The stripper can't be trusted, or failed: back to the CPU for good, and say why. */
  #dropStripper(failure: StripperFailure): void {
    const setup = this.#stripping;
    this.useStripper(null);
    setup?.onFailure?.(failure);
  }

  #abortInFlight(): void {
    const inFlight = this.#inFlight;
    if (!inFlight) return;
    this.#inFlight = null;
    inFlight.abort.abort();
    this.#sentBatch = [];
    // its promise settles later and, aborted, does nothing
    inFlight.done.catch(() => undefined);
  }

  #rejectedClaims(): number {
    let total = 0;
    for (let slot = 0; slot < this.slotCount(); slot++) total += unsigned32(this.#raw.proof_slot_rejected_claims(slot));
    return total;
  }

  /** Back to idle; the prover keeps its tables for the next candidate. */
  #clear(slot: number): void {
    this.#raw.proof_slot_clear(slot);
    this.#candidateInSlot[slot] = null;
  }

  /** Writes the candidate's limbs and starts its slot. False if memory ran out. */
  #start(slot: number, candidate: bigint): boolean {
    const raw = this.#raw;
    const limbs = toLimbs(candidate);
    const pointer = unsigned32(raw.proof_input_buffer(limbs.length));
    if (pointer === 0) return false;
    // A fresh view after every call: memory growth detaches old ones.
    new Uint32Array(raw.memory.buffer, pointer, limbs.length).set(limbs);
    if (raw.proof_slot_start(slot, limbs.length) !== 1) return false;
    this.#candidateInSlot[slot] = candidate;
    return true;
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
