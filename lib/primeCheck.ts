// The prime checker (/is-prime): what it reads, the evidence for its answers
// (and how wasm/number_check.c's verdicts become them), the independent
// re-check of that evidence, and what the page says. The worker decides with
// the C engine; everything here is plain BigInt, so it can check the worker's
// answers and be tested on its own.

import { shortNumber } from "./certificateCheck.ts";
import { checkCertificate, type CertificateStep } from "./primes/primalityCertificate.ts";
import { parseJumpTarget, type JumpTargetResult } from "./primes/parseJumpTarget.ts";
import { primalityTableBelow } from "./primes/sieveOfEratosthenes.ts";
import {
  compositeEvidenceHolds,
  DETERMINISTIC_VERIFICATION_LIMIT,
  failsStrongLucas,
  millerRabinBasesFor,
  millerRabinVerdict,
} from "./primes/verifyPrimes.ts";

/** Factors are looked for among the primes below this; past it, a witness is the evidence. */
export const SMALL_FACTOR_LIMIT = 65_536;

/** What the box reads: the jump box's rules (digit separators, any size), with its own empty message. */
export function parseNumberToCheck(userInput: string): JumpTargetResult {
  const parsed = parseJumpTarget(userInput);
  if (!parsed.valid && userInput.replace(/[\s,_]/g, "") === "") return { valid: false, message: "Type a number to check." };
  return parsed;
}

/**
 * The primes below SMALL_FACTOR_LIMIT, in groups whose product stays below 2^52,
 * so a group's remainder is an exact `number`. Built once.
 */
let smallPrimeGroups: { product: bigint; groups: { product: bigint; primes: number[] }[] } | null = null;
/** A group's product stays below this, so its remainders are exact in a double. */
const GROUP_PRODUCT_LIMIT = 2 ** 52;

function primeGroups() {
  if (smallPrimeGroups) return smallPrimeGroups;
  const isPrime = primalityTableBelow(SMALL_FACTOR_LIMIT);
  const groups: { product: bigint; primes: number[] }[] = [];
  let primes: number[] = [];
  let product = 1;
  for (let candidate = 2; candidate < SMALL_FACTOR_LIMIT; candidate++) {
    if (!isPrime[candidate]) continue;
    if (product * candidate >= GROUP_PRODUCT_LIMIT) {
      groups.push({ product: BigInt(product), primes });
      [primes, product] = [[], 1];
    }
    primes.push(candidate);
    product *= candidate;
  }
  groups.push({ product: BigInt(product), primes });
  smallPrimeGroups = { product: groups.reduce((all, group) => all * group.product, 1n), groups };
  return smallPrimeGroups;
}

/**
 * The smallest prime below SMALL_FACTOR_LIMIT that divides `value` and isn't
 * `value` itself, or null. One division by the product of all of them (about
 * 94,000 bits), then each group's remainder of that, then plain numbers: n mod p
 * is (n mod P) mod p for any P that p divides. Fast at any size.
 */
export function smallestSmallFactor(value: bigint): bigint | null {
  if (value < 4n) return null;
  const { product, groups } = primeGroups();
  const remainder = value % product;
  for (const group of groups) {
    const groupRemainder = Number(remainder % group.product);
    for (const prime of group.primes) {
      if (BigInt(prime) >= value) return null;
      if (groupRemainder % prime === 0) return BigInt(prime);
    }
  }
  return null;
}

/** The whole square root of `value`, if it's a perfect square (> 0), or null. */
export function exactSquareRoot(value: bigint): bigint | null {
  if (value < 1n) return null;
  const root = integerSquareRoot(value);
  return root * root === value ? root : null;
}

/** ⌊√value⌋, for value ≥ 1: Newton's method from above. */
function integerSquareRoot(value: bigint): bigint {
  let estimate = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const better = (estimate + value / estimate) >> 1n;
    if (better >= estimate) return estimate;
    estimate = better;
  }
}

/** How a composite was shown to be one. */
export type CompositeEvidence =
  | { by: "factor"; factor: bigint }
  /** A Miller–Rabin witness base (2 past a(13), from BPSW). */
  | { by: "witness"; base: number }
  | { by: "square"; root: bigint }
  /** Fails BPSW's strong Lucas test (Selfridge's parameters), which no prime can. */
  | { by: "lucas" };

/** How a prime was proven. */
export type PrimeProof =
  /** No prime up to its square root divides it (below SMALL_FACTOR_LIMIT²). */
  | { by: "trial-division" }
  /** Deterministic Miller–Rabin, below a(13), with these bases. */
  | { by: "miller-rabin"; bases: readonly bigint[] }
  /** An elliptic curve certificate, from a(13) up. */
  | { by: "certificate"; steps: readonly CertificateStep[] };

export type PrimeCheckAnswer =
  /** 0 and 1: neither prime nor composite. */
  | { kind: "neither"; value: bigint }
  | { kind: "prime"; value: bigint; proof: PrimeProof }
  /** Passed BPSW, from a(13) up. Not a proof: the page says so, and offers one. */
  | { kind: "probably-prime"; value: bigint }
  | { kind: "composite"; value: bigint; evidence: CompositeEvidence };

/** Below this, finding no factor below SMALL_FACTOR_LIMIT proves a number prime. */
const TRIAL_DIVISION_PROVES_BELOW = BigInt(SMALL_FACTOR_LIMIT) ** 2n;

/** How a number with no small factor that the worker found prime below a(13) was proven. */
export function proofBelowProvenBound(value: bigint): PrimeProof {
  return value < TRIAL_DIVISION_PROVES_BELOW ? { by: "trial-division" } : { by: "miller-rabin", bases: millerRabinBasesFor(value) };
}

/** wasm/primality.h's primality_verdict, as check_number returns it. */
export const NUMBER_CHECK_VERDICT = {
  prime: 0,
  compositeByFactor: 1,
  compositeByWitness: 2,
  belowTwo: 3,
  beyondProvenBound: 4,
  outOfMemory: 5,
  probablePrime: 6,
  compositeBySquare: 7,
  compositeByLucas: 8,
} as const;

export type VerdictAnswer =
  | { settled: true; answer: PrimeCheckAnswer }
  /** Memory ran out: nothing is settled. Anything else is a verdict check_number never gives. */
  | { settled: false; reason: "out-of-memory" | "unexpected-verdict" };

/**
 * The answer check_number's verdict and evidence give for `value` (with no
 * factor below SMALL_FACTOR_LIMIT: the worker looks for one first). Not yet
 * checked: answerHolds does that.
 */
export function answerFromVerdict(value: bigint, verdict: number, evidence: number): VerdictAnswer {
  const settled = (answer: PrimeCheckAnswer): VerdictAnswer => ({ settled: true, answer });
  switch (verdict) {
    case NUMBER_CHECK_VERDICT.belowTwo:
      return settled({ kind: "neither", value });
    case NUMBER_CHECK_VERDICT.prime:
      return settled({ kind: "prime", value, proof: proofBelowProvenBound(value) });
    case NUMBER_CHECK_VERDICT.probablePrime:
      return settled({ kind: "probably-prime", value });
    case NUMBER_CHECK_VERDICT.compositeByFactor:
      return settled({ kind: "composite", value, evidence: { by: "factor", factor: BigInt(evidence) } });
    case NUMBER_CHECK_VERDICT.compositeByWitness:
      return settled({ kind: "composite", value, evidence: { by: "witness", base: evidence } });
    case NUMBER_CHECK_VERDICT.compositeBySquare: {
      const root = exactSquareRoot(value);
      return root === null
        ? { settled: false, reason: "unexpected-verdict" }
        : settled({ kind: "composite", value, evidence: { by: "square", root } });
    }
    case NUMBER_CHECK_VERDICT.compositeByLucas:
      return settled({ kind: "composite", value, evidence: { by: "lucas" } });
    case NUMBER_CHECK_VERDICT.outOfMemory:
      return { settled: false, reason: "out-of-memory" };
    default:
      return { settled: false, reason: "unexpected-verdict" }; // beyondProvenBound, -1, or anything else
  }
}

/**
 * Whether an answer's evidence holds, checked here in BigInt, independently of
 * the C engine that found it (Requirement A3). A "probably prime" claims no
 * proof, so it holds if the number is past a(13) and has no small factor.
 */
export function answerHolds(answer: PrimeCheckAnswer): boolean {
  const { value } = answer;
  switch (answer.kind) {
    case "neither":
      return value === 0n || value === 1n;
    case "probably-prime":
      return value >= DETERMINISTIC_VERIFICATION_LIMIT && smallestSmallFactor(value) === null;
    case "prime": {
      const { proof } = answer;
      if (value < 2n || smallestSmallFactor(value) !== null) return false;
      if (proof.by === "trial-division") return value < TRIAL_DIVISION_PROVES_BELOW;
      if (proof.by === "miller-rabin") return value < DETERMINISTIC_VERIFICATION_LIMIT && millerRabinVerdict(value) === "prime";
      return proof.steps[0]?.number === value && checkCertificate(value, proof.steps).valid;
    }
    case "composite": {
      const { evidence } = answer;
      if (evidence.by === "factor") return evidence.factor > 1n && evidence.factor < value && value % evidence.factor === 0n;
      if (evidence.by === "witness") return compositeEvidenceHolds(value, evidence.base);
      if (evidence.by === "square") return evidence.root > 1n && evidence.root * evidence.root === value;
      return value % 2n === 1n && value > 41n && failsStrongLucas(value);
    }
  }
}

export interface AnswerText {
  /** “1,000,003 is prime.” */
  headline: string;
  /** Why, in a sentence or three. */
  explanation: string;
}

/** What the page says for an answer. Long numbers are shortened (the page shows them in full too). */
export function describeAnswer(answer: PrimeCheckAnswer): AnswerText {
  const { value } = answer;
  const shown = shortNumber(value);
  switch (answer.kind) {
    case "neither":
      return value === 0n
        ? {
            headline: "0 isn’t prime.",
            explanation: "Nor is it composite: every whole number divides 0, and a prime has exactly two divisors, 1 and itself.",
          }
        : {
            headline: "1 isn’t prime.",
            explanation: "A prime has exactly two divisors, 1 and itself, and 1 has only one. It isn’t composite either.",
          };
    case "probably-prime":
      return {
        headline: `${shown} is almost certainly prime.`,
        explanation:
          "It passes the Baillie–PSW test. No composite number is known to pass it, but nobody has proven that none does, so this isn’t a proof yet. “Prove it” builds one.",
      };
    case "prime": {
      const headline = `${shown} is prime.`;
      const { proof } = answer;
      if (value === 2n) return { headline, explanation: "Its only divisors are 1 and 2. It’s the only even prime." };
      if (value === 3n) return { headline, explanation: "Its only divisors are 1 and 3." };
      if (proof.by === "trial-division") {
        const root = shortNumber(integerSquareRoot(value));
        return {
          headline,
          explanation: `None of the primes up to ${root} divides it, and every composite number has a prime factor no larger than its square root.`,
        };
      }
      if (proof.by === "miller-rabin") {
        const bases = proof.bases.length === 1 ? "base 2" : `the first ${proof.bases.length} primes as bases (2 to ${proof.bases.at(-1)})`;
        return {
          headline,
          explanation: `Proven by Miller–Rabin with ${bases}. For a number this size that’s a proof, not a probability: the smallest composite that passes all of them is known (OEIS A014233), and ${shown} is below it.`,
        };
      }
      return { headline, explanation: "Proven by the elliptic curve certificate below, which this page checked step by step." };
    }
    case "composite": {
      const { evidence } = answer;
      if (evidence.by === "factor") {
        const cofactor = shortNumber(value / evidence.factor);
        return evidence.factor === 2n
          ? { headline: `${shown} isn’t prime: it’s even.`, explanation: `It’s divisible by 2: ${shown} = 2 × ${cofactor}.` }
          : {
              headline: `${shown} isn’t prime: it’s divisible by ${shortNumber(evidence.factor)}.`,
              explanation: `${shown} = ${shortNumber(evidence.factor)} × ${cofactor}.`,
            };
      }
      if (evidence.by === "square") {
        const root = shortNumber(evidence.root);
        return { headline: `${shown} isn’t prime: it’s ${root}².`, explanation: `${shown} = ${root} × ${root}.` };
      }
      const noSmallFactor = `It has no factor below ${SMALL_FACTOR_LIMIT.toLocaleString("en-US")}, and the test proves it has one without finding it.`;
      if (evidence.by === "witness")
        return {
          headline: `${shown} isn’t prime: ${evidence.base} is a Miller–Rabin witness.`,
          explanation: `Write ${shown} − 1 as 2ˢ × d, with d odd. If ${shown} were prime, ${evidence.base}ᵈ mod ${shown} would be 1, or squaring it would reach ${shown} − 1 within s steps. Neither happens, so it can’t be prime. ${noSmallFactor}`,
        };
      return {
        headline: `${shown} isn’t prime: it fails the strong Lucas test.`,
        explanation: `Every prime passes this test (with Selfridge’s parameters), so failing it proves ${shown} composite. ${noSmallFactor}`,
      };
    }
  }
}
