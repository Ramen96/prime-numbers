// How much memory the base primes may use, how much a batch will need, and
// when to restart the worker to give memory back.
//
// The limit is the device, not the code (CLAUDE.md, rule 2). sieve.wasm is
// built with -sMAXIMUM_MEMORY=4GB, all a 32-bit Wasm module can address. The
// budget is half the device's memory where the browser reports it; otherwise
// there's no budget and the base primes grow until an allocation fails. Either
// way, a failed allocation rolls the base primes back (wasm/sieve.c) and the
// list stops at the last proven prime.

import { logarithmicIntegral } from "./logarithmicIntegral.ts";

/** All a wasm32 module can address (and what `npm run build:wasm` allows). */
export const WASM_ADDRESS_SPACE_BYTES = 2 ** 32;

/**
 * Left for everything that isn't base primes: the 32 KB segment, the batch
 * buffers, the stack, malloc's own bookkeeping.
 */
const NON_BASE_PRIME_HEADROOM_BYTES = 64 * 2 ** 20;

/** The most the base primes could ever use, on any device. */
export const LARGEST_BASE_PRIME_BUDGET_BYTES = WASM_ADDRESS_SPACE_BYTES - NON_BASE_PRIME_HEADROOM_BYTES;

/**
 * The base-prime budget for a device with `deviceMemoryGiB` of RAM
 * (navigator.deviceMemory), or null when the browser doesn't say (Safari and
 * Firefox don't), meaning "grow until an allocation fails".
 *
 * Half the RAM leaves the rest for the system, the browser and other tabs.
 * Browsers round deviceMemory down and cap it at 8 (a privacy measure), so
 * "8" means "at least 8 GiB", and half of that already reaches the module's
 * 4 GiB address space.
 */
export function basePrimeMemoryBudget(deviceMemoryGiB: number | undefined): number | null {
  if (deviceMemoryGiB === undefined || !(deviceMemoryGiB > 0)) return null;
  return Math.min(Math.floor((deviceMemoryGiB * 2 ** 30) / 2), LARGEST_BASE_PRIME_BUDGET_BYTES);
}

/**
 * A proven lower bound on the bytes the base primes below `limit` take: each
 * odd prime after 3 is at least one byte (sieve.c stores halved gaps). Uses
 * π(x) ≥ (x / ln x)(1 + 1 / ln x) for x ≥ 599 (P. Dusart, "Inégalités
 * explicites pour ψ(X), θ(X), π(X) et les nombres premiers", C. R. Math.
 * Rep. Acad. Sci. Canada 21 (1999)), within about 1% of π(x) at these sizes.
 * A jump is refused only when even this doesn't fit, so nothing that would
 * fit is ever refused.
 */
export function fewestBasePrimeBytes(limit: bigint): number {
  if (limit < 599n) return 0;
  const logarithm = Math.log(Number(limit));
  return Math.floor((Number(limit) / logarithm) * (1 + 1 / logarithm)) - 2;
}

/**
 * How many bytes to reserve for the base primes below `limit`, so they're
 * allocated once instead of grown step by step. li(x) is just above π(x) at
 * every size this can reach; 1% and 64 KB on top cover the rare 9-byte gaps
 * and small limits. If it's ever short, sieve.c grows the storage itself.
 */
export function estimatedBasePrimeBytes(limit: bigint): number {
  if (limit < 2n) return 0;
  return Math.ceil(logarithmicIntegral(limit) * 1.01) + 64 * 1024;
}

/**
 * False when base primes below `limit` certainly don't fit in `budgetBytes`
 * (or, with no budget, in the module's address space), so the memory-limit
 * state can be shown at once instead of after minutes of building.
 * sieve.c stores base primes as uint64_t, so limits of 2^64 or more never fit
 * (holding every prime up to 2^64 would take about 4 × 10^17 bytes anyway).
 */
export function basePrimesCouldFit(limit: bigint, budgetBytes: number | null): boolean {
  if (limit >= 2n ** 64n) return false;
  return fewestBasePrimeBytes(limit) <= (budgetBytes ?? LARGEST_BASE_PRIME_BUDGET_BYTES);
}

/**
 * Below this, a worker's memory isn't worth a restart. (The rebuild is cheap
 * either way: the fresh worker only builds what the new region needs, at most
 * a quarter of what the old one held.) Jumping near 2^63 grows a worker to
 * about 150 MB, so jumping back from there releases it.
 */
const SMALLEST_MEMORY_WORTH_RELEASING_BYTES = 128 * 2 ** 20;

/**
 * Wasm memory never shrinks: once the worker has grown for a far-out region,
 * it keeps that memory until it's terminated. Restart it when a jump needs
 * less than a quarter of what it holds and what it holds is worth releasing.
 * The fresh worker rebuilds only the base primes the new region needs.
 */
export function shouldRestartWorkerToReleaseMemory(
  workerMemoryBytes: number,
  bytesNeededForJump: number,
): boolean {
  return (
    workerMemoryBytes >= SMALLEST_MEMORY_WORTH_RELEASING_BYTES &&
    bytesNeededForJump < workerMemoryBytes / 4
  );
}
