// Choosing how to sieve by measuring this device (CLAUDE.md, Phase 4): where
// partial sieving with Miller–Rabin starts to beat the full sieve, and which
// cap on the base primes makes partial sieving fastest.
//
// Only the decisions are here. The timing functions are passed in, so this
// knows nothing about Wasm or workers, and tests can give it any timings.
//
// Every timed batch is real work on the same numbers, so the methods can also
// check each other: batches from the same place must hold identical primes
// (Requirements A2 and A3). If they don't, the caller stops with an error.

/** One batch's primes, and how long finding them took. */
export interface TimedBatch {
  durationMs: number;
  primes: readonly bigint[];
}

/** Times a full-sieve batch from `from`, or null if its base primes wouldn't fit. */
export type TimeFullSieve = (from: bigint) => TimedBatch | null;
/** Times a partial-sieve batch from `from`, with base primes up to `cap`. */
export type TimePartialSieve = (from: bigint, cap: bigint) => TimedBatch;

/** Two batches from the same place held different primes. */
export interface MethodsDisagree {
  agreed: false;
  from: bigint;
}

/** The first rung of the ladder. Below 2^32, a cap of 65,535 is already the full sieve. */
export const FIRST_LADDER_BITS = 36;
/** Bits between rungs: the full sieve's cost grows smoothly, so a coarse ladder finds the crossover. */
export const LADDER_STEP_BITS = 4;
/** Runs per measurement, keeping the fastest: a slow run is noise, and never a fast one. */
export const RUNS_PER_MEASUREMENT = 3;
/** How much faster partial sieving must be to win, as for splitting a window across threads (sieve.c). */
export const CLEARLY_FASTER = 0.9;
/** The caps to try, smallest first. The cost is broad around its best, so a coarse grid is enough. */
export const CAPS_TO_TRY = [2n ** 12n, 2n ** 14n, 2n ** 16n, 2n ** 18n, 2n ** 20n];

function samePrimes(first: readonly bigint[], second: readonly bigint[]): boolean {
  return first.length === second.length && first.every((prime, index) => prime === second[index]);
}

/**
 * The fastest of a few runs, as long as every run's primes match `expected`
 * (or the first run's, if none is given yet). Stops at the first run that
 * can't run at all, since a failed build of base primes can take minutes.
 */
function fastestRun(
  run: () => TimedBatch | null,
  expected: readonly bigint[] | null,
): TimedBatch | "primes-differ" | "did-not-fit" {
  let fastest: TimedBatch | null = null;
  for (let count = 0; count < RUNS_PER_MEASUREMENT; count++) {
    const batch = run();
    if (batch === null) return "did-not-fit";
    if (!samePrimes(batch.primes, expected ?? fastest?.primes ?? batch.primes)) return "primes-differ";
    if (fastest === null || batch.durationMs < fastest.durationMs) fastest = batch;
  }
  return fastest!; // RUNS_PER_MEASUREMENT is above 0
}

/**
 * Where to start sieving partially: climbs a ladder of sizes, timing a batch
 * both ways at each rung, and stops at the first where partial sieving is
 * clearly faster, or where the full sieve wouldn't fit. The full sieve's cost
 * grows with √x and partial sieving's barely does, so past that rung partial
 * stays ahead, and no base primes are ever built above it. The ladder has no
 * top: the full sieve always stops fitting somewhere.
 */
export function findPartialSieveStart(
  timeFullSieve: TimeFullSieve,
  timePartialSieve: TimePartialSieve,
  partialCap: bigint,
): { agreed: true; partialSieveFrom: bigint } | MethodsDisagree {
  for (let bits = FIRST_LADDER_BITS; ; bits += LADDER_STEP_BITS) {
    const from = 1n << BigInt(bits);
    const full = fastestRun(() => timeFullSieve(from), null);
    if (full === "did-not-fit") return { agreed: true, partialSieveFrom: from };
    if (full === "primes-differ") return { agreed: false, from };

    const partial = fastestRun(() => timePartialSieve(from, partialCap), full.primes);
    if (typeof partial === "string") return { agreed: false, from };
    if (partial.durationMs < full.durationMs * CLEARLY_FASTER) return { agreed: true, partialSieveFrom: from };
  }
}

/**
 * The cap that makes partial sieving fastest at `from`. A tie goes to the
 * smaller cap, which holds fewer base primes.
 */
export function findFastestCap(
  timePartialSieve: TimePartialSieve,
  from: bigint,
): { agreed: true; cap: bigint } | MethodsDisagree {
  let fastestCap = CAPS_TO_TRY[0];
  let fastestMs = Infinity;
  let expected: readonly bigint[] | null = null;
  for (const cap of CAPS_TO_TRY) {
    const batch = fastestRun(() => timePartialSieve(from, cap), expected);
    if (typeof batch === "string") return { agreed: false, from };
    expected = batch.primes;
    if (batch.durationMs < fastestMs) {
      fastestMs = batch.durationMs;
      fastestCap = cap;
    }
  }
  return { agreed: true, cap: fastestCap };
}
