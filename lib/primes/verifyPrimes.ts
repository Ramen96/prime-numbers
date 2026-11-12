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
//
// From a(13) up, Miller–Rabin proves nothing, so a prime there must come with
// a primality certificate (Phase 5), checked by primalityCertificate.ts.

// primalityCertificate.ts imports millerRabinVerdict from here too. The cycle
// is harmless: both modules only export functions, and neither calls the
// other while loading.
import { checkCertificate, type CertificateStep } from "./primalityCertificate.ts";
import type { RejectedComposite, RejectionKind } from "./wasmSieve.ts";

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

function jacobi(top: bigint, bottom: bigint): number {
  let result = 1;
  let [a, n] = [((top % bottom) + bottom) % bottom, bottom];
  while (a !== 0n) {
    while ((a & 1n) === 0n) {
      a >>= 1n;
      if (n % 8n === 3n || n % 8n === 5n) result = -result;
    }
    [a, n] = [n, a];
    if (a % 4n === 3n && n % 4n === 3n) result = -result;
    a %= n;
  }
  return n === 1n ? result : 0;
}

function isPerfectSquare(value: bigint): boolean {
  let estimate = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const better = (estimate + value / estimate) >> 1n;
    if (better >= estimate) return estimate * estimate === value;
    estimate = better;
  }
}

/**
 * Whether odd `candidate` (> 41) is proven composite with no number as evidence
 * (BPSW's other verdicts): it's a perfect square, or it fails the strong Lucas
 * test with Selfridge's parameters, which no prime can. Never true for a prime.
 */
export function failsStrongLucas(candidate: bigint): boolean {
  if (isPerfectSquare(candidate)) return true;
  let d = 5n;
  for (;;) {
    const symbol = jacobi(d, candidate);
    if (symbol === -1) break;
    if (symbol === 0 && (d < 0n ? -d : d) % candidate !== 0n) return true; // shares a factor
    d = d > 0n ? -(d + 2n) : -d + 2n;
  }
  const q = (1n - d) / 4n;
  const reduce = (value: bigint) => ((value % candidate) + candidate) % candidate;
  const halve = (value: bigint) => {
    const reduced = reduce(value);
    return ((reduced & 1n) === 1n ? reduced + candidate : reduced) >> 1n;
  };
  let oddPart = candidate + 1n;
  let powersOfTwo = 0;
  while ((oddPart & 1n) === 0n) {
    oddPart >>= 1n;
    powersOfTwo++;
  }
  let [u, v, qPower] = [1n, 1n, reduce(q)];
  for (const bit of oddPart.toString(2).slice(1)) {
    [u, v] = [reduce(u * v), reduce(v * v - 2n * qPower)];
    qPower = reduce(qPower * qPower);
    if (bit === "1") {
      [u, v] = [halve(u + v), halve(d * u + v)];
      qPower = reduce(qPower * q);
    }
  }
  if (u === 0n || v === 0n) return false;
  for (let round = 1; round < powersOfTwo; round++) {
    v = reduce(v * v - 2n * qPower);
    qPower = reduce(qPower * qPower);
    if (v === 0n) return false;
  }
  return true;
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

/** Certificates for primes from a(13) up, keyed by the prime each one proves. */
export type Certificates = ReadonlyMap<bigint, readonly CertificateStep[]>;

const NO_CERTIFICATES: Certificates = new Map();

/** The primes alone: each one proven prime, or the first that isn't. */
export type PrimesVerification =
  | { verified: true }
  /** Miller–Rabin found it composite, or it's from a(13) up and has no certificate. */
  | { verified: false; disputedPrime: bigint; verdict: Exclude<Verdict, "prime"> }
  /** Its certificate doesn't prove it prime; `reason` is the checker's. */
  | { verified: false; disputedPrime: bigint; verdict: "certificate-invalid"; reason: string };

/** A whole batch: its primes, and the composites the sieve rejected. */
export type BatchVerification =
  | PrimesVerification
  /** The sieve rejected it as composite, but its evidence (or check of that kind) doesn't prove that. */
  | { verified: false; disputedComposite: bigint; evidence: number; kind: RejectionKind };

/**
 * Checks every prime in a batch. Stops at the first one that isn't proven prime.
 * Below a(13), Miller–Rabin decides. From a(13) up, the prime's certificate must
 * pass checkCertificate; one with no certificate stays "beyond-proven-bound",
 * so nothing gets through for want of a proof.
 */
export function verifyPrimes(primes: readonly bigint[], certificates: Certificates = NO_CERTIFICATES): PrimesVerification {
  for (const prime of primes) {
    const verdict = millerRabinVerdict(prime);
    if (verdict === "prime") continue;
    const certificate = verdict === "beyond-proven-bound" ? certificates.get(prime) : undefined;
    if (certificate === undefined) return { verified: false, disputedPrime: prime, verdict };
    const check = checkCertificate(prime, certificate);
    if (!check.valid) {
      const reason = check.number === prime ? check.reason : `${check.reason} (at ${check.number})`;
      return { verified: false, disputedPrime: prime, verdict: "certificate-invalid", reason };
    }
  }
  return { verified: true };
}

/**
 * Whether a rejected composite really is one: its evidence holds, or for BPSW's
 * verdicts with no number (past a(13)), the square and strong Lucas tests fail it
 * again here, in BigInt. Neither can hold for a prime, so a prime rejected by
 * mistake is always caught.
 */
export function rejectionHolds({ candidate, evidence, kind }: RejectedComposite): boolean {
  if (kind === "evidence") return compositeEvidenceHolds(candidate, evidence);
  if (kind === "unknown") return false;
  return candidate % 2n === 1n && candidate > 41n && failsStrongLucas(candidate);
}

/** Checks every rejected composite. Stops at the first that doesn't hold. */
export function verifyRejectedComposites(rejected: readonly RejectedComposite[]): BatchVerification {
  for (const composite of rejected) {
    if (!rejectionHolds(composite)) {
      const { candidate, evidence, kind } = composite;
      return { verified: false, disputedComposite: candidate, evidence, kind };
    }
  }
  return { verified: true };
}

/** A whole batch: every prime proven prime, then every rejected composite proven composite. */
export function verifyBatch(
  primes: readonly bigint[],
  rejected: readonly RejectedComposite[] = [],
  certificates: Certificates = NO_CERTIFICATES,
): BatchVerification {
  const primesVerification = verifyPrimes(primes, certificates);
  return primesVerification.verified ? verifyRejectedComposites(rejected) : primesVerification;
}
