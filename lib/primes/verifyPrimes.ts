// Independent verification of the sieve's output (CLAUDE.md, Requirement A3).
//
// Every prime the sieve finds is re-checked here with a deterministic
// Miller–Rabin test before it's shown, and every survivor the sieve's own
// Miller–Rabin rejected (Phase 4) has its evidence checked, so a prime can't
// be skipped silently either. This shares no code with the sieve (it's
// TypeScript and BigInt; the sieve is C), so a bug in one is caught by the
// other. If they ever disagree, the batch is never shown.
//
// Miller–Rabin with the first k primes as bases has no false "prime" below a
// proven bound. The bounds are OEIS A014233, https://oeis.org/A014233/b014233.txt:
// a(k) is the smallest odd composite that passes with the first k prime bases
// (a(12) and a(13) from J. Sorenson and J. Webster, "Strong Pseudoprimes to
// Twelve Prime Bases", Math. Comp. 86 (2017), https://arxiv.org/abs/1509.00864).
// Using only as many bases as each number needs keeps it fast for small primes.

import type { RejectedComposite } from "./wasmSieve.ts";

const PRIME_BASES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n];

/** For each count of bases k, the first odd composite they let through: A014233(k). */
const FIRST_COMPOSITE_PASSING_K_BASES = [
  2047n,
  1_373_653n,
  25_326_001n,
  3_215_031_751n,
  2_152_302_898_747n,
  3_474_749_660_383n,
  341_550_071_728_321n,
  341_550_071_728_321n,
  3_825_123_056_546_413_051n,
  3_825_123_056_546_413_051n,
  3_825_123_056_546_413_051n,
  318_665_857_834_031_151_167_461n,
  3_317_044_064_679_887_385_961_981n,
];

/** Below this, Miller–Rabin with all 13 bases is proven deterministic. */
export const DETERMINISTIC_VERIFICATION_LIMIT = FIRST_COMPOSITE_PASSING_K_BASES[12];

export type Verdict = "prime" | "composite" | "beyond-proven-bound";

function powerMod(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  base %= modulus;
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % modulus;
    base = (base * base) % modulus;
    exponent >>= 1n;
  }
  return result;
}

/**
 * Whether `base` is a Miller–Rabin witness for odd `candidate` (> base + 1):
 * proof that it's composite. No base is ever a witness for a prime.
 */
function isWitness(candidate: bigint, base: bigint): boolean {
  let oddPart = candidate - 1n;
  let powersOfTwo = 0;
  while ((oddPart & 1n) === 0n) {
    oddPart >>= 1n;
    powersOfTwo++;
  }
  let value = powerMod(base, oddPart, candidate);
  if (value === 1n || value === candidate - 1n) return false;
  for (let round = 1; round < powersOfTwo; round++) {
    value = (value * value) % candidate;
    if (value === candidate - 1n) return false;
  }
  return true;
}

/**
 * Whether `evidence` proves `candidate` composite: it divides it (and isn't 1
 * or the candidate itself), or it's a Miller–Rabin witness for it. Either is a
 * proof, so this never holds for a prime: one rejected by mistake is caught.
 */
export function compositeEvidenceHolds(candidate: bigint, evidence: number): boolean {
  const base = BigInt(evidence);
  if (base > 1n && base < candidate && candidate % base === 0n) return true;
  return candidate % 2n === 1n && base > 1n && candidate > base + 1n && isWitness(candidate, base);
}

/** Deterministic Miller–Rabin, with only as many bases as `candidate` needs. */
export function millerRabinVerdict(candidate: bigint): Verdict {
  if (candidate < 2n) return "composite";
  for (const base of PRIME_BASES) {
    if (candidate === base) return "prime";
    if (candidate % base === 0n) return "composite";
  }
  if (candidate >= DETERMINISTIC_VERIFICATION_LIMIT) return "beyond-proven-bound";

  const basesNeeded = FIRST_COMPOSITE_PASSING_K_BASES.findIndex((bound) => candidate < bound) + 1;
  for (const base of PRIME_BASES.slice(0, basesNeeded)) {
    if (isWitness(candidate, base)) return "composite"; // proof that candidate is composite
  }
  return "prime";
}

/** The primes alone: each one proven prime, or the first that isn't. */
export type PrimesVerification =
  | { verified: true }
  | { verified: false; disputedPrime: bigint; verdict: Exclude<Verdict, "prime"> };

/** A whole batch: its primes, and the composites the sieve rejected. */
export type BatchVerification =
  | PrimesVerification
  /** The sieve rejected it as composite, but its evidence doesn't prove that. */
  | { verified: false; disputedComposite: bigint; evidence: number };

/** Checks every prime in a batch. Stops at the first one that isn't proven prime. */
export function verifyPrimes(primes: readonly bigint[]): PrimesVerification {
  for (const prime of primes) {
    const verdict = millerRabinVerdict(prime);
    if (verdict !== "prime") return { verified: false, disputedPrime: prime, verdict };
  }
  return { verified: true };
}

/** Checks every rejected composite's evidence. Stops at the first that doesn't hold. */
export function verifyRejectedComposites(rejected: readonly RejectedComposite[]): BatchVerification {
  for (const { candidate, evidence } of rejected) {
    if (!compositeEvidenceHolds(candidate, evidence)) return { verified: false, disputedComposite: candidate, evidence };
  }
  return { verified: true };
}

/** A whole batch: every prime proven prime, then every rejected composite proven composite. */
export function verifyBatch(primes: readonly bigint[], rejected: readonly RejectedComposite[] = []): BatchVerification {
  const primesVerification = verifyPrimes(primes);
  return primesVerification.verified ? verifyRejectedComposites(rejected) : primesVerification;
}
