// The small sieve of Eratosthenes animated on the 404 page. Plain numbers,
// not BigInt: the range is a few fixed numbers near 404, chosen in code.

/** One number in the animated range. */
export interface SieveCell {
  value: number;
  /** The prime whose multiples cross this number out, or null for a prime. */
  crossedOutBy: number | null;
  /** Which pass crosses it out (0 for the first), or, for a prime, the pass after the last. */
  pass: number;
}

export interface SieveAnimation {
  cells: SieveCell[];
  /** The primes that cross something out, in order: one pass each. */
  passes: number[];
  /** The numbers left standing. */
  survivors: number[];
}

/** Primes up to `limit`, by trial division (the limit is tiny). */
function primesUpTo(limit: number): number[] {
  const primes: number[] = [];
  for (let candidate = 2; candidate <= limit; candidate++) {
    if (primes.every((prime) => candidate % prime !== 0)) primes.push(candidate);
  }
  return primes;
}

/**
 * Sieves `from` to `to` (inclusive, from ≥ 2) the way Eratosthenes did: for
 * each prime p up to √to, cross out the multiples of p from p² on. Each
 * number is crossed out by its smallest prime factor, the first prime to reach
 * it. Primes that find nothing new get no pass, so the animation never pauses.
 */
export function sieveAnimation(from: number, to: number): SieveAnimation {
  const values = Array.from({ length: to - from + 1 }, (_, index) => from + index);
  const crossedOutBy = new Map<number, number>();
  const passes: number[] = [];

  for (const prime of primesUpTo(Math.floor(Math.sqrt(to)))) {
    let crossedSomething = false;
    for (const value of values) {
      if (value >= prime * prime && value % prime === 0 && !crossedOutBy.has(value)) {
        crossedOutBy.set(value, prime);
        crossedSomething = true;
      }
    }
    if (crossedSomething) passes.push(prime);
  }

  const cells = values.map((value) => {
    const prime = crossedOutBy.get(value) ?? null;
    return { value, crossedOutBy: prime, pass: prime === null ? passes.length : passes.indexOf(prime) };
  });
  const survivors = cells.filter((cell) => cell.crossedOutBy === null).map((cell) => cell.value);
  return { cells, passes, survivors };
}
