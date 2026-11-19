// How hot the CPU graphic runs, from the speed counter's rate. Both scales are
// logarithmic, because the rate falls across orders of magnitude.

/** Primes/sec at which heat is 0 (cool). */
const COOL_RATE = 1e7;
/** Primes/sec at which heat is 1 (overheating), and meltdown begins. */
const HOT_RATE = 1e5; // about where the list is near 10^24 on a laptop
/** Primes/sec at which the meltdown is complete: one prime every ten minutes (about 1,000 digits on a laptop). */
export const MELTDOWN_FULL_RATE = 1 / 600;

/** Where `primesPerSecond` sits from `fastRate` (0) down to `slowRate` (1), on a log scale, clamped. */
function progressTowardSlow(primesPerSecond: number, fastRate: number, slowRate: number): number {
  const fastExponent = Math.log10(fastRate);
  const progress = (fastExponent - Math.log10(primesPerSecond)) / (fastExponent - Math.log10(slowRate));
  return Math.min(1, Math.max(0, progress));
}

/** Heat in 0..1: fast = cool (0), slow = hot (1). */
export function heatFromRate(primesPerSecond: number): number {
  if (!(primesPerSecond > 0)) return 0;
  return progressTowardSlow(primesPerSecond, COOL_RATE, HOT_RATE);
}

/** At this rate or slower (one prime a minute), the Stop button says “Give up”. */
export const GIVE_UP_RATE = 1 / 60;

/** Whether single primes take a minute or more: then Stop reads “Give up” (it does the same thing). */
export function primesTakeMinutes(primesPerSecond: number): boolean {
  return primesPerSecond > 0 && primesPerSecond <= GIVE_UP_RATE;
}

/**
 * Meltdown in 0..1, the scale after heat: 0 until heat is at its top, then up
 * to 1 at one prime every ten minutes. Heat stops changing near 10^24, while
 * the rate keeps falling for another eight orders of magnitude, through proofs.
 */
export function meltdownFromRate(primesPerSecond: number): number {
  if (!(primesPerSecond > 0)) return 0;
  return progressTowardSlow(primesPerSecond, HOT_RATE, MELTDOWN_FULL_RATE);
}
