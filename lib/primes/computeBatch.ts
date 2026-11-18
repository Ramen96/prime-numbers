// What the worker does for one batch request, as a plain function so it can
// be tested with a stand-in sieve (the worker itself is a thin shell around it).
//
// Three steps, each timed on its own:
//   1. choose how to sieve: past the point measured on this device
//      (sieveCalibrator.ts), or if base primes can't fit, cap them and sieve
//      partially (Phase 4); otherwise build the ones the batch needs (setup,
//      like the measuring: not sieving speed),
//   2. sieve, with Miller–Rabin proving what partial sieving can't, and past
//      a(13), where the sieve only filters with BPSW, an ECPP certificate for
//      each prime (Phase 5),
//   3. verify every prime and every rejected composite independently
//      (Requirement A3), never sending a batch the check disagrees with.

import { basePrimesCouldFit } from "./memoryBudget.ts";
import type { CertificateStep } from "./primalityCertificate.ts";
import type { ProveOptions, ProvenInOrder } from "./proofSlots.ts";
import type { ProvenPrimeCache } from "./provenPrimeCache.ts";
import type { BatchRequest, WorkerMemory, WorkerResponse } from "./protocol.ts";
import { buildBasePrimes, PARTIAL_SIEVE_PRIME_CAP, type SieveCalibrator } from "./sieveCalibrator.ts";
import {
  DETERMINISTIC_VERIFICATION_LIMIT,
  verifyBatch,
  type BatchVerification,
  type Certificates,
} from "./verifyPrimes.ts";
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
  verify?: (
    primes: bigint[],
    rejected: RejectedComposite[],
    certificates: Certificates,
  ) => BatchVerification | Promise<BatchVerification>;
  /**
   * Proves candidates past a(13) in the order given (ProofSlots.proveInOrder),
   * returning certificates for as many as it could. Without it nothing is
   * proven there, and verification refuses every prime past a(13).
   */
  prove?: (
    candidates: bigint[],
    options: Pick<ProveOptions, "shouldStop" | "onProven" | "onProgress">,
  ) => Promise<ProvenInOrder>;
  /**
   * True once this request should stop (a pause for it, or a newer request).
   * Checked before sieving and between proving runs: sieving itself can't be
   * interrupted, so a stop while sieving takes effect once proving starts.
   */
  shouldStop?: () => boolean;
  /**
   * Primes past a(13) already proven and checked (provenPrimeCache.ts): they
   * skip proving and checking. Each newly checked one is added once the batch
   * is sent. Without it, every prime past a(13) is proven every time.
   */
  provenPrimes?: Pick<ProvenPrimeCache, "has" | "add">;
  /** What's measured on this device. Without one, only memory decides how to sieve. */
  calibrator?: Pick<SieveCalibrator, "capFor">;
  now?: () => number;
}

export async function computeBatch(
  sieve: Sieve,
  { id, generation, direction, from, count }: BatchRequest,
  send: (response: WorkerResponse) => void,
  {
    memoryBudgetBytes,
    threads = 1,
    verify = verifyBatch,
    prove,
    shouldStop = () => false,
    provenPrimes,
    calibrator,
    now = () => performance.now(),
  }: ComputeBatchOptions,
): Promise<void> {
  if (shouldStop()) return; // paused or replaced before it began: nothing done, nothing to say
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
  const sieved = sieve.findPrimes(direction, from, count);
  const { rejected, measuringMs } = sieved;
  const { primes } = sieved;
  let { reachedMemoryLimit } = sieved;
  // With probable primes allowed (loadSieve.ts), the sieve never stops at
  // a(13): past it, BPSW passes come here to be proven. If it ever did stop
  // there, the list would quietly end, so say so instead.
  if (sieved.reachedProvenBound) {
    send({
      type: "error",
      id,
      generation,
      message: "The sieve stopped at 3.3 × 10²⁴ instead of passing the next number on to be proven.",
    });
    return;
  }

  // Measuring where splitting windows across threads pays (once per window
  // size, at most a dozen times a worker) is setup, like building base
  // primes: the speed counter only counts sieving.
  const sievingDurationMs = now() - sievingStartTime - measuringMs;
  setupDurationMs += measuringMs;

  // Step 3: check before showing (Requirement A3). First every composite the
  // sieve rejected (a prime rejected by mistake would be skipped) and every
  // prime below a(13), which Miller–Rabin settles. Nothing past a(13) can be
  // shown before these, since a wrong rejection would leave a gap before it.
  let verificationDurationMs = 0;
  const timedVerify = async (toCheck: bigint[], toReject: RejectedComposite[], certificates: Certificates) => {
    const startTime = now();
    const verification = await verify(toCheck, toReject, certificates);
    verificationDurationMs += now() - startTime;
    return verification;
  };
  const isPastBound = (prime: bigint) => prime >= DETERMINISTIC_VERIFICATION_LIMIT;
  const alreadyProven = (prime: bigint) => provenPrimes?.has(prime) ?? false;
  const upFront = await timedVerify(
    primes.filter((prime) => !isPastBound(prime)),
    rejected,
    new Map(),
  );
  if (!upFront.verified) {
    send({ type: "error", id, generation, message: disputeMessage(upFront) });
    return;
  }

  // Step 4, past a(13): the sieve's primes there are only BPSW passes, so each
  // needs a certificate, unless it's kept from an earlier proof (it passed this
  // check then). They're proven in the order they join the list (upward for
  // "next", downward for "prev"), and each is shown once it and everything
  // before it are proven and checked: a few at a time, at most every
  // STREAM_INTERVAL_MS. If memory runs out on one, it and everything after it
  // stay pending, as when the sieve runs out of memory. Proving is part of
  // finding primes, so it counts as sieving time; checking runs alongside it.
  const inListOrder = direction === "next" ? primes : [...primes].reverse();
  const needsProof = (prime: bigint) => isPastBound(prime) && !alreadyProven(prime);
  const toProve = inListOrder.filter(needsProof);
  const checked = new Set<bigint>();
  let settledCount = 0; // inListOrder[0 .. settledCount) can be shown
  let sentCount = 0; // and inListOrder[0 .. sentCount) have been
  let foundSinceSent = 0;
  let findingMark = now() - sievingDurationMs; // finding time is measured from here
  let lastSentTime = -Infinity;
  let proving = false;
  let dispute: Exclude<BatchVerification, { verified: true }> | null = null;

  const settle = () => {
    while (settledCount < inListOrder.length) {
      const prime = inListOrder[settledCount];
      if (needsProof(prime) && !checked.has(prime)) break;
      if (!alreadyProven(prime) || checked.has(prime)) foundSinceSent++;
      settledCount++;
    }
  };
  /** The settled primes not yet sent, ascending, and how many of them were found now. */
  const takeUnsent = () => {
    const unsent = inListOrder.slice(sentCount, settledCount);
    sentCount = settledCount;
    const foundCount = foundSinceSent;
    foundSinceSent = 0;
    return { primes: direction === "next" ? unsent : unsent.reverse(), foundCount };
  };
  const streamIfDue = () => {
    if (!proving || settledCount === sentCount || now() - lastSentTime < STREAM_INTERVAL_MS) return;
    const time = now();
    const { primes: shown, foundCount } = takeUnsent();
    const findingDurationMs = time - findingMark;
    send({ type: "proven", id, generation, direction, primes: shown, foundCount, findingDurationMs });
    findingMark = time;
    lastSentTime = time;
  };

  // Certificates are checked one group at a time, in order, as they arrive:
  // the verification pool serves one call at a time.
  let waitingForCheck: { prime: bigint; certificate: readonly CertificateStep[] }[] = [];
  let checking: Promise<void> = Promise.resolve();
  let checkScheduled = false;
  const checkWaiting = async () => {
    checkScheduled = false;
    const group = waitingForCheck;
    waitingForCheck = [];
    if (dispute || group.length === 0) return;
    const certificates = new Map(group.map(({ prime, certificate }) => [prime, certificate]));
    const verification = await timedVerify(
      group.map(({ prime }) => prime),
      [],
      certificates,
    );
    if (!verification.verified) {
      dispute = verification;
      return;
    }
    for (const { prime } of group) {
      checked.add(prime);
      provenPrimes?.add(prime); // proven and checked: never proven again
    }
    settle();
    streamIfDue();
  };

  settle();
  let outOfMemory = false;
  let finalFindingMs: number | null = null;
  if (prove && toProve.length > 0) {
    send({ type: "proving", id, generation });
    proving = true;
    let waitingSince = now(); // when the list started waiting on the prime it's waiting on now
    let lastProgressTime = -Infinity;
    const proven = await prove(toProve, {
      shouldStop: () => shouldStop() || dispute !== null,
      onProgress: (index, reachedBits) => {
        const time = now();
        if (time - lastProgressTime < PROGRESS_INTERVAL_MS) return;
        lastProgressTime = time;
        const digits = toProve[index].toString().length;
        send({
          type: "proving-progress",
          id,
          generation,
          direction,
          elapsedMs: time - waitingSince,
          digits,
          reachedDigits: Math.min(digits, digitsOfBitLength(reachedBits)),
        });
      },
      onProven: (index, certificate) => {
        waitingSince = now(); // the list now waits on the next one
        waitingForCheck.push({ prime: toProve[index], certificate });
        if (!checkScheduled) {
          checkScheduled = true;
          checking = checking.then(checkWaiting);
        }
      },
    });
    const provingEndTime = now();
    proving = false;
    await checking;
    if (dispute) {
      send({ type: "error", id, generation, message: disputeMessage(dispute) });
      return;
    }
    if (proven.stopped) {
      send({ type: "paused", id, generation });
      return;
    }
    outOfMemory = proven.outOfMemory;
    // the rest is measured to when proving ended: waiting for the last checks isn't finding
    finalFindingMs = Math.max(0, provingEndTime - findingMark);
  }
  // Without a prover, primes past a(13) stay unsettled: refused, as unproven.
  if (!prove && toProve.length > 0) {
    const verification = await timedVerify([toProve[0]], [], new Map());
    if (!verification.verified) {
      send({ type: "error", id, generation, message: disputeMessage(verification) });
      return;
    }
  }
  if (outOfMemory) reachedMemoryLimit = true;
  if (sentCount === 0 && settledCount === 0 && reachedMemoryLimit) {
    send({ type: "memory-limit", id, generation, memory: memory() });
    return;
  }

  // The rest of the batch. Primes proven before the sieve (or the prover) ran
  // out of memory are still sent; the next request in this direction then
  // reports why it stopped.
  const finalTime = now();
  const { primes: rest, foundCount } = takeUnsent();
  send({
    type: "batch",
    id,
    generation,
    direction,
    primes: rest,
    foundCount,
    reachedMemoryLimit,
    sievingDurationMs: finalFindingMs ?? finalTime - findingMark,
    setupDurationMs,
    verificationDurationMs,
    memory: memory(),
    threads,
  });
}

/**
 * The least time between two streamed pieces of a batch. Near a(13) proofs
 * take about a millisecond, and a message per prime would swamp the page;
 * far out, a prime takes seconds, and each is shown at once.
 */
export const STREAM_INTERVAL_MS = 100;

/** The least time between two progress reports on the prime the list is waiting on. */
export const PROGRESS_INTERVAL_MS = 1000;

/** About how many decimal digits a number of `bits` bits has: the fewest it could have. */
export function digitsOfBitLength(bits: number): number {
  return bits <= 0 ? 0 : Math.floor((bits - 1) * Math.log10(2)) + 1;
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
  if (verification.verdict === "certificate-invalid") {
    return (
      `The certificate for ${verification.disputedPrime} doesn’t prove it prime (${verification.reason}). ` +
      `Stopped rather than show it.`
    );
  }
  const problem =
    verification.verdict === "composite"
      ? "Miller–Rabin found it composite"
      : "it is beyond the bound where Miller–Rabin is proven deterministic, and has no certificate";
  return `The sieve reported ${verification.disputedPrime} as prime, but ${problem}. Stopped rather than show it.`;
}
