// The random-prime page's rules, kept apart from the worker and React so they
// can be tested: how many digits it takes, what it asks the worker, and what a
// finished request means.

import type { CertificateStep } from "./primes/primalityCertificate.ts";
import type { BatchRequest, ProvenPrimeCertificate } from "./primes/protocol.ts";

/**
 * The fewest digits: the smallest 26-digit number, 10^25, is past a(13) ≈ 3.3 × 10^24,
 * so every prime from here gets an elliptic curve certificate to show. Below it,
 * Miller–Rabin proves primes and leaves no certificate.
 */
export const RANDOM_PRIME_MIN_DIGITS = 26;
/** About 0.3 s to prove in a browser, so the first try is quick. */
export const RANDOM_PRIME_DEFAULT_DIGITS = 100;

export type DigitsInput = { valid: true; digits: number } | { valid: false; message: string };

/** What the visitor typed as a number of digits: a whole number, at least 26, with no upper limit. */
export function parseDigits(typed: string): DigitsInput {
  const text = typed.replace(/[\s,_]/g, "");
  if (text === "") return { valid: false, message: "Type how many digits the prime should have." };
  if (!/^\d+$/.test(text)) return { valid: false, message: "A whole number of digits, like 100." };
  const digits = Number(text);
  if (digits < RANDOM_PRIME_MIN_DIGITS)
    return {
      valid: false,
      message: `At least ${RANDOM_PRIME_MIN_DIGITS} digits: smaller primes are proven without a certificate to show.`,
    };
  if (!Number.isSafeInteger(digits)) return { valid: false, message: "That’s more digits than this page can count." };
  return { valid: true, digits };
}

/**
 * The request for the first prime from `start` on (the worker's "next" excludes
 * `from`, so it's one less), with its certificate.
 */
export function randomPrimeRequest(id: number, start: bigint, useGpu = false): BatchRequest {
  return {
    type: "batch",
    id,
    generation: 1,
    direction: "next",
    from: start - 1n,
    count: 1,
    includeCertificates: true,
    useGpu,
    loneProof: true,
  };
}

export type RandomPrimeOutcome =
  | { kind: "found"; prime: bigint; certificate: readonly CertificateStep[] }
  /** The first prime after the start has a digit more than asked for (the start was in the last gap): draw again. */
  | { kind: "draw-again" }
  | { kind: "error"; message: string };

/** What a finished request's primes and certificates mean, for a prime of `digits` digits. */
export function randomPrimeOutcome(
  digits: number,
  primes: readonly bigint[],
  certificates: readonly ProvenPrimeCertificate[],
): RandomPrimeOutcome {
  const prime = primes[0];
  if (prime === undefined) return { kind: "error", message: "The worker finished without a prime." };
  if (prime.toString().length !== digits) return { kind: "draw-again" };
  const certificate = certificates.find((entry) => entry.prime === prime);
  if (certificate === undefined) return { kind: "error", message: "The prime arrived without its certificate." };
  return { kind: "found", prime, certificate: certificate.steps };
}
