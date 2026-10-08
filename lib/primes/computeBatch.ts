// What the worker does for one batch request, as a plain function so it can
// be tested with a stand-in sieve (the worker itself is a thin shell around it).
//
// Three steps, each timed on its own:
//   1. build the base primes the batch needs (setup: not sieving speed),
//   2. sieve,
//   3. verify every prime independently (Requirement A3), never sending a
//      batch the check disagrees with.

import { basePrimesCouldFit, estimatedBasePrimeBytes } from "./memoryBudget.ts";
import type { BatchRequest, WorkerMemory, WorkerResponse } from "./protocol.ts";
import { verifyPrimes, type BatchVerification } from "./verifyPrimes.ts";
import { basePrimeLimitNeededFor, type SieveBatch } from "./wasmSieve.ts";

/** The parts of WasmSieve a batch uses (so tests can stand in for it). */
export interface Sieve {
  basePrimeLimit(): bigint;
  extendBasePrimes(limit: bigint): boolean;
  reserveBasePrimeStorage(bytes: number): boolean;
  basePrimeMemoryBytes(): number;
  moduleMemoryBytes(): number;
  findPrimes(direction: BatchRequest["direction"], from: bigint, count: number): SieveBatch;
}

export interface ComputeBatchOptions {
  /** The base-prime budget set in the sieve, or null for none (see memoryBudget.ts). */
  memoryBudgetBytes: number | null;
  /** Threads sieving each window, reported with the batch. */
  threads?: number;
  /** How to verify a batch: inline by default, or spread over workers (verificationPool.ts). */
  verify?: (primes: bigint[]) => BatchVerification | Promise<BatchVerification>;
  now?: () => number;
}

export async function computeBatch(
  sieve: Sieve,
  { id, generation, direction, from, count }: BatchRequest,
  send: (response: WorkerResponse) => void,
  { memoryBudgetBytes, threads = 1, verify = verifyPrimes, now = () => performance.now() }: ComputeBatchOptions,
): Promise<void> {
  const memory = (): WorkerMemory => ({
    basePrimeBytes: sieve.basePrimeMemoryBytes(),
    moduleBytes: sieve.moduleMemoryBytes(),
  });

  // performance.now() precision depends on cross-origin isolation (the
  // COOP/COEP headers in next.config.ts): microseconds when isolated, 0.1 ms
  // or coarser when not. Fast batches can still measure 0 ms; the rate meter
  // averages over many batches to handle that.

  // Step 1: base primes. If they certainly can't fit in the budget, say so
  // now rather than after minutes of building. Otherwise reserve their
  // storage in one allocation from an estimate (if that fails, the sieve
  // still grows it step by step until an allocation fails). The C call can't
  // report progress, so announce it first.
  const basePrimeLimitNeeded = basePrimeLimitNeededFor(direction, from, count);
  if (!basePrimesCouldFit(basePrimeLimitNeeded, memoryBudgetBytes)) {
    send({ type: "memory-limit", id, generation, memory: memory() });
    return;
  }
  let setupDurationMs = 0;
  if (basePrimeLimitNeeded >= sieve.basePrimeLimit()) {
    send({ type: "building-base-primes", id, generation });
    const setupStartTime = now();
    const estimatedBytes = estimatedBasePrimeBytes(basePrimeLimitNeeded);
    sieve.reserveBasePrimeStorage(
      memoryBudgetBytes === null ? estimatedBytes : Math.min(estimatedBytes, memoryBudgetBytes),
    );
    const extended = sieve.extendBasePrimes(basePrimeLimitNeeded);
    setupDurationMs = now() - setupStartTime;
    if (!extended) {
      send({ type: "memory-limit", id, generation, memory: memory() });
      return;
    }
  }

  // Step 2: sieve. (sieve_next/sieve_prev still extend the base primes
  // themselves if step 1 guessed short.)
  const sievingStartTime = now();
  const { primes, reachedMemoryLimit, measuringMs } = sieve.findPrimes(direction, from, count);
  // Measuring where splitting windows across threads pays (once per window
  // size, at most a dozen times a worker) is setup, like building base
  // primes: the speed counter only counts sieving.
  const sievingDurationMs = now() - sievingStartTime - measuringMs;
  setupDurationMs += measuringMs;
  if (primes.length === 0 && reachedMemoryLimit) {
    send({ type: "memory-limit", id, generation, memory: memory() });
    return;
  }

  // Step 3: verify every prime before it's shown. If the check and the sieve
  // ever disagree, stop: the disputed batch is never sent.
  const verificationStartTime = now();
  const verification = await verify(primes);
  const verificationDurationMs = now() - verificationStartTime;
  if (!verification.verified) {
    const problem =
      verification.verdict === "composite"
        ? "Miller–Rabin found it composite"
        : "it is beyond the bound where Miller–Rabin is proven deterministic";
    send({
      type: "error",
      id,
      generation,
      message: `The sieve reported ${verification.disputedPrime} as prime, but ${problem}. Stopped rather than show it.`,
    });
    return;
  }

  // Primes proven before the memory limit was reached are still sent; the
  // next request in this direction then reports the limit.
  send({
    type: "batch",
    id,
    generation,
    direction,
    primes,
    reachedMemoryLimit,
    sievingDurationMs,
    setupDurationMs,
    verificationDurationMs,
    memory: memory(),
    threads,
  });
}
