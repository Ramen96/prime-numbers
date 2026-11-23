// The trial division demo on /how-to-tell-if-a-number-is-prime: divide a number
// by each prime up to its square root, showing every remainder, until one
// divides it evenly. Plain numbers, not BigInt: the demo stops at 10,000, so the
// largest prime it ever tries is 97 (below √10,000 = 100), and anything bigger
// goes to the prime checker.

import { primalityTableBelow } from "./primes/sieveOfEratosthenes.ts";

/** The largest number the demo divides: at most 25 divisions, one per prime below 100. */
export const TRIAL_DIVISION_DEMO_MAX = 10_000;
/** What the field starts with, and the answer the page is built with. */
export const TRIAL_DIVISION_DEMO_START = 97;

const isPrime = primalityTableBelow(Math.floor(Math.sqrt(TRIAL_DIVISION_DEMO_MAX)) + 1);
const DIVISORS = Array.from(isPrime.keys()).filter((candidate) => isPrime[candidate] === 1);

export type TrialDivisionInput =
  | { kind: "number"; value: number }
  /** A whole number past the demo's range, as typed (without separators), for the checker's ?n=. */
  | { kind: "too-big"; digits: string }
  | { kind: "invalid" };

/** A whole number, with commas, spaces or underscores between digits allowed (like the checker). */
export function parseTrialDivisionInput(typed: string): TrialDivisionInput {
  const digits = typed.trim().replace(/[,_\s]/g, "");
  if (!/^\d+$/.test(digits)) return { kind: "invalid" };
  const withoutLeadingZeros = digits.replace(/^0+(?=\d)/, "");
  if (withoutLeadingZeros.length > String(TRIAL_DIVISION_DEMO_MAX).length || Number(withoutLeadingZeros) > TRIAL_DIVISION_DEMO_MAX)
    return { kind: "too-big", digits: withoutLeadingZeros };
  return { kind: "number", value: Number(withoutLeadingZeros) };
}

export interface TrialDivisionStep {
  divisor: number;
  quotient: number;
  remainder: number;
}

export interface TrialDivision {
  value: number;
  /** Every division tried, in order; the last one has remainder 0 if a factor was found. */
  steps: TrialDivisionStep[];
  /** The smallest prime factor, or null if the number is prime (or below 2). */
  factor: number | null;
}

/** Divides `value` (0 to TRIAL_DIVISION_DEMO_MAX) by each prime p with p² ≤ value, stopping at the first that divides it. */
export function trialDivision(value: number): TrialDivision {
  if (!Number.isInteger(value) || value < 0 || value > TRIAL_DIVISION_DEMO_MAX)
    throw new RangeError(`The demo divides whole numbers from 0 to ${TRIAL_DIVISION_DEMO_MAX}, not ${value}`);
  const steps: TrialDivisionStep[] = [];
  for (const divisor of DIVISORS) {
    if (divisor * divisor > value) break;
    const remainder = value % divisor;
    steps.push({ divisor, quotient: (value - remainder) / divisor, remainder });
    if (remainder === 0) return { value, steps, factor: divisor };
  }
  return { value, steps, factor: null };
}

const formatted = (value: number) => value.toLocaleString("en-US");

/** “97 ÷ 7 = 13, remainder 6” */
export function describeStep(value: number, step: TrialDivisionStep): string {
  return `${formatted(value)} ÷ ${formatted(step.divisor)} = ${formatted(step.quotient)}, remainder ${formatted(step.remainder)}`;
}

/** √value to one decimal place, rounded down, so “the primes up to” it never takes in one too many. */
export function squareRootToOneDecimal(value: number): string {
  return (Math.floor(Math.sqrt(value) * 10) / 10).toFixed(1);
}

/** The answer's sentence, in three parts so the page can link the number itself. */
export interface TrialDivisionConclusion {
  before: string;
  number: string;
  after: string;
}

export function trialDivisionConclusion({ value, steps, factor }: TrialDivision): TrialDivisionConclusion {
  const number = formatted(value);
  if (value < 2) return { before: "", number, after: " isn’t prime: primes start at 2." };
  if (factor !== null) {
    const cofactor = formatted(value / factor);
    return { before: `${formatted(factor)} divides ${number} evenly: ${number} = ${formatted(factor)} × ${cofactor}, so `, number, after: " isn’t prime." };
  }
  const root = squareRootToOneDecimal(value);
  if (steps.length === 0)
    return { before: `No prime is at or below √${number} ≈ ${root}, so there’s nothing to try: `, number, after: " is prime." };
  return { before: `None of the primes up to √${number} ≈ ${root} divides it, so `, number, after: " is prime." };
}

export const TRIAL_DIVISION_INVALID_MESSAGE = "Type a whole number, like 97.";
export const TRIAL_DIVISION_TOO_BIG_MESSAGE = "That’s more than this demo divides.";
