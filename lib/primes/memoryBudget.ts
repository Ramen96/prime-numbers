// How much memory the base primes may use, how much a batch will need, and
// when to restart the worker to give memory back.
//
// The limit is the device, not the code (CLAUDE.md, rule 2). Both builds can
// address 4 GiB, all a 32-bit Wasm module can. The budget is for the whole
// module: a quarter of the device's memory where the browser reports it.
// Base primes get the budget minus an allowance for everything else. The
// threaded build's shared memory is created with the budget as its maximum,
// so nothing in the module can pass it; where the browser doesn't report its
// memory, the largest maximum it agrees to reserve is used instead. Either
// way, a failed allocation rolls the base primes back (wasm/sieve.c) and the
// list stops at the last proven prime.

import { logarithmicIntegral } from "./logarithmicIntegral.ts";

/** All a wasm32 module can address (and what `npm run build:wasm` allows). */
export const WASM_ADDRESS_SPACE_BYTES = 2 ** 32;

/** Wasm memory comes in pages of 64 KiB. */
export const WASM_PAGE_BYTES = 65_536;

/**
 * Left for everything in the module that isn't base primes: its 16 MB
 * starting memory (code, stack, the 32 KB segment, batch buffers), each
 * sieving thread's stack and copy of the segment, malloc's own bookkeeping.
 * At most half of a small budget.
 */
const NON_BASE_PRIME_ALLOWANCE_BYTES = 64 * 2 ** 20;

/** The base-prime budget within a module that may use `moduleBytes` in all. */
export function basePrimeBudgetWithin(moduleBytes: number): number {
  return moduleBytes - Math.min(NON_BASE_PRIME_ALLOWANCE_BYTES, Math.floor(moduleBytes / 2));
}

/** The most the base primes could ever use, on any device. */
export const LARGEST_BASE_PRIME_BUDGET_BYTES = basePrimeBudgetWithin(WASM_ADDRESS_SPACE_BYTES);

/**
 * The whole module's budget on a device with `deviceMemoryGiB` of RAM
 * (navigator.deviceMemory), in whole 64 KiB Wasm pages, or null when the
 * browser doesn't say (Safari and Firefox don't).
 *
 * A quarter of the RAM leaves plenty for the system, the browser and other
 * tabs: stopping honestly at the memory-limit notice is better than the
 * browser killing the tab. Browsers round deviceMemory down and cap it at 8
 * (a privacy measure), so "8" means "at least 8 GiB" and gives 2 GiB.
 */
export function moduleMemoryBudget(deviceMemoryGiB: number | undefined): number | null {
  if (deviceMemoryGiB === undefined || !(deviceMemoryGiB > 0)) return null;
  const quarter = Math.floor((deviceMemoryGiB * 2 ** 30) / 4 / WASM_PAGE_BYTES) * WASM_PAGE_BYTES;
  return Math.min(quarter, WASM_ADDRESS_SPACE_BYTES);
}

/** The base-prime budget on such a device, or null for "grow until an allocation fails". */
export function basePrimeMemoryBudget(deviceMemoryGiB: number | undefined): number | null {
  const moduleBudget = moduleMemoryBudget(deviceMemoryGiB);
  return moduleBudget === null ? null : basePrimeBudgetWithin(moduleBudget);
}

/** Below this, a threaded module isn't worth starting: the standalone build is used. */
const SMALLEST_SHARED_MEMORY_BYTES = 256 * 2 ** 20;

/**
 * The maximums to try, largest first, when creating the threaded build's
 * shared memory. Browsers reserve a shared memory's whole maximum up front,
 * and some refuse large ones: iOS Safari throws "Out of memory" for 4 GiB
 * while 2 GiB works, and 32-bit Android can't reserve 4 GiB at all. So: the
 * budget if there is one, else 4 GiB; then halves, down to 256 MiB.
 */
export function sharedMemoryMaximumsToTry(moduleBudget: number | null): number[] {
  const maximums: number[] = [];
  for (let maximum = moduleBudget ?? WASM_ADDRESS_SPACE_BYTES; maximum >= SMALLEST_SHARED_MEMORY_BYTES; maximum /= 2) {
    maximums.push(Math.floor(maximum / WASM_PAGE_BYTES) * WASM_PAGE_BYTES);
  }
  return maximums;
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
