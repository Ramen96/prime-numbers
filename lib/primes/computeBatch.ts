// What the worker does for one batch request, as a plain function so it can
// be tested with a stand-in sieve (the worker itself is a thin shell around it).
//
// Three steps, each timed on its own:
//   1. choose how to sieve: past the point measured on this device
//      (sieveCalibrator.ts), or if base primes can't fit, cap them and sieve
//      partially (Phase 4); otherwise build the ones the batch needs (setup,
//      like the measuring: not sieving speed),
//   2. sieve, with Miller–Rabin proving what partial sieving can't,
//   3. verify every prime and every rejected composite independently
//      (Requirement A3), never sending a batch the check disagrees with.

import { basePrimesCouldFit } from "./memoryBudget.ts";
import type { BatchRequest, WorkerMemory, WorkerResponse } from "./protocol.ts";
import { buildBasePrimes, PARTIAL_SIEVE_PRIME_CAP, type SieveCalibrator } from "./sieveCalibrator.ts";
import { verifyBatch, type BatchVerification } from "./verifyPrimes.ts";
import {
  basePrimeLimitNeededFor,
  NO_SIEVE_PRIME_CAP,
  type RejectedComposite,
  type SieveBatch,
} from "./wasmSieve.ts";

/** The parts of WasmSieve a batch uses (so tests can stand in for it). */
export interface Sieve {
  basePrimeLimit(): bigint;
  extendBasePrimes(limit: bigint): boolean;
  reserveBasePrimeStorage(bytes: number): boolean;
  basePrimeMemoryBytes(): number;
  moduleMemoryBytes(): number;
  setSievePrimeCap(cap: bigint): void;
  findPrimes(direction: BatchRequest["direction"], from: bigint, count: number): SieveBatch;
}

export interface ComputeBatchOptions {
  /** The base-prime budget set in the sieve, or null for none (see memoryBudget.ts). */
  memoryBudgetBytes: number | null;
  /** Threads sieving each window, reported with the batch. */
  threads?: number;
  /** How to verify a batch: inline by default, or spread over workers (verificationPool.ts). */
  verify?: (primes: bigint[], rejected: RejectedComposite[]) => BatchVerification | Promise<BatchVerification>;
  /** What's measured on this device. Without one, only memory decides how to sieve. */
  calibrator?: Pick<SieveCalibrator, "capFor">;
  now?: () => number;
}

export async function computeBatch(
  sieve: Sieve,
  { id, generation, direction, from, count }: BatchRequest,
  send: (response: WorkerResponse) => void,
  { memoryBudgetBytes, threads = 1, verify = verifyBatch, calibrator, now = () => performance.now() }: ComputeBatchOptions,
): Promise<void> {
  const memory = (): WorkerMemory => ({
    basePrimeBytes: sieve.basePrimeMemoryBytes(),
    moduleBytes: sieve.moduleMemoryBytes(),
  });

  // performance.now() precision depends on cross-origin isolation (the
  // COOP/COEP headers in next.config.ts): microseconds when isolated, 0.1 ms
  // or coarser when not. Fast batches can still measure 0 ms; the rate meter
  // averages over many batches to handle that.

  // Step 1: how to sieve. Past the point measured on this device, partially,
  // with the measured cap, and nothing is built. Below it, if every base prime
  // the batch needs could fit in the budget, build them and sieve fully:
  // reserve their storage in one allocation from an estimate (if that fails,
  // the sieve still grows it step by step until an allocation fails); the C
  // call can't report progress, so announce it first. If they certainly can't
  // fit, or building them runs out of memory, sieve partially instead, with the
  // base primes up to PARTIAL_SIEVE_PRIME_CAP. The cap also keeps the sieve from
  // trying (and failing) to build them again for every window.
  const basePrimeLimitNeeded = basePrimeLimitNeededFor(direction, from, count);
  let sievePrimeCap = NO_SIEVE_PRIME_CAP;
  let setupDurationMs = 0;
  const decision = calibrator?.capFor(from);
  if (decision && !decision.agreed) {
    send({
      type: "error",
      id,
      generation,
      message: `Two ways of finding primes gave different answers near ${decision.from}. Stopped rather than show either.`,
    });
    return;
  }
  if (decision) setupDurationMs = decision.setupMs;
  if (decision?.cap != null) {
    sievePrimeCap = decision.cap;
  } else if (!basePrimesCouldFit(basePrimeLimitNeeded, memoryBudgetBytes)) {
    sievePrimeCap = PARTIAL_SIEVE_PRIME_CAP;
  } else if (basePrimeLimitNeeded >= sieve.basePrimeLimit()) {
    send({ type: "building-base-primes", id, generation });
    const setupStartTime = now();
    const extended = buildBasePrimes(sieve, basePrimeLimitNeeded, memoryBudgetBytes);
    setupDurationMs += now() - setupStartTime;
    if (!extended) sievePrimeCap = PARTIAL_SIEVE_PRIME_CAP;
  }
  sieve.setSievePrimeCap(sievePrimeCap);

  // Step 2: sieve. (sieve_next/sieve_prev still extend the base primes
  // themselves if step 1 guessed short.) Miller–Rabin's proofs of what
  // partial sieving can't settle are part of finding primes, so they count
  // as sieving time.
  const sievingStartTime = now();
  const { primes, rejected, reachedMemoryLimit, reachedProvenBound, measuringMs } = sieve.findPrimes(
    direction,
    from,
    count,
  );
  // Measuring where splitting windows across threads pays (once per window
  // size, at most a dozen times a worker) is setup, like building base
  // primes: the speed counter only counts sieving.
  const sievingDurationMs = now() - sievingStartTime - measuringMs;
  setupDurationMs += measuringMs;

  // Step 3: verify every prime before it's shown, and every composite
  // Miller–Rabin rejected (a prime rejected by mistake would be skipped). If
  // the check and the sieve ever disagree, stop: the disputed batch is never
  // sent. Done even when there are no primes: the rejections still count.
  const verificationStartTime = now();
  const verification = await verify(primes, rejected);
  const verificationDurationMs = now() - verificationStartTime;
  if (!verification.verified) {
    send({ type: "error", id, generation, message: disputeMessage(verification) });
    return;
  }
  if (primes.length === 0 && reachedProvenBound) {
    send({ type: "proven-bound", id, generation, memory: memory() });
    return;
  }
  if (primes.length === 0 && reachedMemoryLimit) {
    send({ type: "memory-limit", id, generation, memory: memory() });
    return;
  }

  // Primes proven before the sieve stopped are still sent; the next request
  // in this direction then reports why it stopped.
  send({
    type: "batch",
    id,
    generation,
    direction,
    primes,
    reachedMemoryLimit,
    reachedProvenBound,
    sievingDurationMs,
    setupDurationMs,
    verificationDurationMs,
    memory: memory(),
    threads,
  });
}

/** What to tell the user when the check disagrees with the sieve. */
function disputeMessage(verification: Exclude<BatchVerification, { verified: true }>): string {
  if ("disputedComposite" in verification) {
    // a prime rejected by mistake would be skipped: the list stops rather than leave a gap
    const evidence =
      verification.kind === "evidence"
        ? `its evidence (${verification.evidence})`
        : verification.kind === "unknown"
          ? "the kind of rejection it gave"
          : `the ${verification.kind === "square" ? "perfect-square" : "strong Lucas"} test`;
    return (
      `The sieve rejected ${verification.disputedComposite} as composite, but ${evidence} ` +
      `doesn’t prove that. Stopped rather than risk skipping a prime.`
    );
  }
  const problem =
    verification.verdict === "composite"
      ? "Miller–Rabin found it composite"
      : "it is beyond the bound where Miller–Rabin is proven deterministic";
  return `The sieve reported ${verification.disputedPrime} as prime, but ${problem}. Stopped rather than show it.`;
}
