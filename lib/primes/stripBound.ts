// How deep the GPU strips curve orders (CLAUDE.md, step 11d): the largest prime
// it tries. Not a fixed table: chosen on the device, as proofs run. The GPU
// strips while the CPU keeps searching (proofSlots.ts), so the right depth is
// the deepest the GPU keeps up with: deeper means fewer curves for the CPU to
// try (step 11a), until the provers start waiting for the GPU.
//
// Each size of order (its limb count) has its own depth. It starts at the CPU's
// own bound and moves one step at a time after each strip call: deeper while
// the provers hardly waited, shallower when they waited a good part of it.

import type { StripReport } from "./proofSlots.ts";

/**
 * The depths, a factor of √10 apart. The CPU's own bounds are 10^5 and 10^6
 * (wasm/ecpp_prover.c). The top is 10^8: step 11a measured the best depth at
 * 10^7 to 10^8 at every size, and the primes are kept in this worker at 4 bytes
 * each (OddPrimeList: 23 MB to 10^8, 200 MB to 10^9) for nothing more. This only
 * decides speed: an order with a larger factor is just skipped for another curve.
 */
export const STRIP_DEPTHS = [
  100_000, 316_228, 1_000_000, 3_162_278, 10_000_000, 31_622_777, 100_000_000,
] as const;

/**
 * Orders of this many limbs or more start at 10^6, like the CPU's own stripping
 * from DEEPER_STRIP_FROM_BITS (830 bits, about 250 digits; 26 limbs are 832 bits).
 */
const DEEPER_FROM_LIMBS = 26;
const DEEPER_START = STRIP_DEPTHS.indexOf(1_000_000);

/** The provers waited less than this share of a strip call: go one step deeper. */
export const DEEPER_BELOW_WAITING = 0.05;
/** They waited more than this share: one step shallower. In between, stay. */
export const SHALLOWER_ABOVE_WAITING = 0.15;

export class StripBound {
  /** Per limb count, the index in STRIP_DEPTHS. */
  readonly #depthIndex = new Map<number, number>();

  /** The largest prime to strip orders of `limbs` limbs with. */
  largestPrimeFor(limbs: number): number {
    return STRIP_DEPTHS[this.#indexFor(limbs)];
  }

  /** After a strip call: one step deeper, or shallower, or the same, for that size of order. */
  record(report: StripReport): void {
    const waitedShare = report.waitedMs / Math.max(report.stripMs, 1);
    const index = this.#indexFor(report.limbs);
    if (waitedShare < DEEPER_BELOW_WAITING) this.#depthIndex.set(report.limbs, Math.min(index + 1, STRIP_DEPTHS.length - 1));
    else if (waitedShare > SHALLOWER_ABOVE_WAITING) this.#depthIndex.set(report.limbs, Math.max(index - 1, startIndex(report.limbs)));
  }

  #indexFor(limbs: number): number {
    return this.#depthIndex.get(limbs) ?? startIndex(limbs);
  }
}

/** The CPU's own bound: never strip shallower than it would. */
function startIndex(limbs: number): number {
  return limbs >= DEEPER_FROM_LIMBS ? DEEPER_START : 0;
}
