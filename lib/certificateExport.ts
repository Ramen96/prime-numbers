// The random-prime page's downloads: a prime's elliptic curve certificate as
// JSON (to check with a program) and as plain text (to read). Both carry the
// same steps, in the format checkCertificate takes; every number is written out
// in full, in decimal.

import type { CertificateStep } from "./primes/primalityCertificate.ts";
import { DETERMINISTIC_VERIFICATION_LIMIT } from "./primes/verifyPrimes.ts";

/** Names the JSON format, so a later change to it can be told apart. */
export const CERTIFICATE_FORMAT = "everyprimenumber.com/ecpp-certificate/1";

/** What the steps mean, in both downloads. */
const EXPLANATION = [
  "Each step gives a number N, a curve y^2 = x^3 + a*x + b (mod N), a point (x, y) on it, and a prime q.",
  "The point times q is the point at infinity, and q > (N^(1/4) + 1)^2, so if q is prime, N is prime",
  "(Goldwasser and Kilian; Atkin and Morain). Each step's q is the next step's N. The last q is below",
  `${DETERMINISTIC_VERIFICATION_LIMIT} (a(13), OEIS A014233), where Miller-Rabin with the first 13 prime`,
  "bases (2 to 41) proves it prime.",
];

interface CertificateJson {
  format: string;
  prime: string;
  explanation: string;
  steps: { N: string; a: string; b: string; x: string; y: string; q: string }[];
  lastStepBelow: string;
}

/** The certificate as JSON, every number a decimal string (JSON numbers can't hold them exactly). */
export function certificateJson(prime: bigint, steps: readonly CertificateStep[]): string {
  const json: CertificateJson = {
    format: CERTIFICATE_FORMAT,
    prime: prime.toString(),
    explanation: EXPLANATION.join(" "),
    steps: steps.map((step) => ({
      N: step.number.toString(),
      a: step.curveA.toString(),
      b: step.curveB.toString(),
      x: step.pointX.toString(),
      y: step.pointY.toString(),
      q: step.orderPrime.toString(),
    })),
    lastStepBelow: DETERMINISTIC_VERIFICATION_LIMIT.toString(),
  };
  return JSON.stringify(json, null, 2) + "\n";
}

export type ReadCertificate =
  | { readable: true; prime: bigint; steps: CertificateStep[] }
  /** `reason` finishes the sentence “That isn’t a certificate this page can read: …”. */
  | { readable: false; reason: string };

/** A step's six numbers, by the names both formats use, in order. */
const STEP_FIELDS = [
  ["N", "number"],
  ["a", "curveA"],
  ["b", "curveB"],
  ["x", "pointX"],
  ["y", "pointY"],
  ["q", "orderPrime"],
] as const;

/**
 * A whole number written in decimal, ignoring the commas, spaces and underscores
 * people group digits with (as the page shows them), or null. Any size.
 */
function wholeNumber(written: unknown): bigint | null {
  if (typeof written !== "string") return null;
  const digits = written.replace(/[\s,_]/g, "");
  return /^\d+$/.test(digits) ? BigInt(digits) : null;
}

/** One step from its written numbers, or why it can't be read. */
function readStep(written: Partial<Record<string, unknown>>, index: number): CertificateStep | string {
  const step: Partial<Record<(typeof STEP_FIELDS)[number][1], bigint>> = {};
  for (const [name, field] of STEP_FIELDS) {
    if (written[name] === undefined) return `step ${index + 1} has no ${name}`;
    const value = wholeNumber(written[name]);
    if (value === null) return `step ${index + 1}’s ${name} isn’t a whole number`;
    step[field] = value;
  }
  return step as CertificateStep;
}

/** The prime and steps, once each has been read, or the first reason one couldn't be. */
function readAll(writtenPrime: unknown, writtenSteps: Partial<Record<string, unknown>>[]): ReadCertificate {
  if (writtenPrime === undefined) return { readable: false, reason: "the prime is missing" };
  const prime = wholeNumber(writtenPrime);
  if (prime === null) return { readable: false, reason: "the prime isn’t a whole number" };
  if (writtenSteps.length === 0) return { readable: false, reason: "it has no steps" };
  const steps: CertificateStep[] = [];
  for (const [index, written] of writtenSteps.entries()) {
    const step = readStep(written, index);
    if (typeof step === "string") return { readable: false, reason: step };
    steps.push(step);
  }
  return { readable: true, prime, steps };
}

/** certificateJson's format. */
function readJson(text: string): ReadCertificate {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { readable: false, reason: "it starts like JSON but doesn’t parse as JSON" };
  }
  if (typeof json !== "object" || json === null || (json as { format?: unknown }).format !== CERTIFICATE_FORMAT)
    return { readable: false, reason: `it’s JSON, but not in this site’s format (“format”: “${CERTIFICATE_FORMAT}”)` };
  const { prime, steps } = json as { prime?: unknown; steps?: unknown };
  if (!Array.isArray(steps)) return { readable: false, reason: "it has no steps" };
  return readAll(prime, steps.map((step) => (typeof step === "object" && step !== null ? step : {})));
}

/**
 * certificateText's format, read loosely: the prime is the first line that's only
 * a number, and each step is the lines “N = …” to “q = …” (a new “N =” starts the
 * next step). The other lines are explanation, and ignored.
 */
function readText(text: string): ReadCertificate {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const primeLine = lines.find((line) => wholeNumber(line) !== null);
  const steps: Record<string, string>[] = [];
  for (const line of lines) {
    const match = /^([Nabxyq])\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, name, value] = match;
    if (name === "N") steps.push({});
    if (steps.length === 0) return { readable: false, reason: `“${name} =” comes before the first step’s N` };
    steps[steps.length - 1][name] = value;
  }
  if (primeLine === undefined && steps.length === 0)
    return { readable: false, reason: "it’s in neither of this page’s formats (JSON or text)" };
  return readAll(primeLine, steps);
}

/**
 * A pasted or uploaded certificate, in either download format (JSON if it starts
 * with “{”, text otherwise): the prime and its steps, or why it can't be read.
 * Reading isn't checking: checkCertificate decides whether it proves anything.
 */
export function readCertificate(text: string): ReadCertificate {
  const trimmed = text.trim();
  if (trimmed === "") return { readable: false, reason: "it’s empty" };
  return trimmed.startsWith("{") ? readJson(trimmed) : readText(trimmed);
}

/** Reads certificateJson's output back: the prime and its steps. Throws on anything else. */
export function certificateFromJson(text: string): { prime: bigint; steps: CertificateStep[] } {
  const read = readCertificate(text);
  if (!read.readable || !text.trim().startsWith("{")) throw new Error(`Not a certificate in ${CERTIFICATE_FORMAT} format`);
  return { prime: read.prime, steps: read.steps };
}

/** The certificate as plain text: what it means, then each step's numbers in full. */
export function certificateText(prime: bigint, steps: readonly CertificateStep[]): string {
  const lines = [
    `Elliptic curve primality certificate for the ${prime.toString().length}-digit number`,
    prime.toString(),
    "",
    ...EXPLANATION,
    "",
  ];
  steps.forEach((step, index) => {
    lines.push(
      `Step ${index + 1} of ${steps.length}`,
      `N = ${step.number}`,
      `a = ${step.curveA}`,
      `b = ${step.curveB}`,
      `x = ${step.pointX}`,
      `y = ${step.pointY}`,
      `q = ${step.orderPrime}`,
      "",
    );
  });
  lines.push(`The last q, ${steps.at(-1)?.orderPrime}, is below ${DETERMINISTIC_VERIFICATION_LIMIT}.`);
  return lines.join("\n") + "\n";
}

/** "prime-100-digits.json": the download's file name. */
export function certificateFileName(prime: bigint, extension: "json" | "txt"): string {
  return `prime-${prime.toString().length}-digits-certificate.${extension}`;
}
