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

/** Reads certificateJson's output back: the prime and its steps. Throws on anything else. */
export function certificateFromJson(text: string): { prime: bigint; steps: CertificateStep[] } {
  const json = JSON.parse(text) as CertificateJson;
  if (json.format !== CERTIFICATE_FORMAT) throw new Error(`Not a certificate in ${CERTIFICATE_FORMAT} format`);
  return {
    prime: BigInt(json.prime),
    steps: json.steps.map((step) => ({
      number: BigInt(step.N),
      curveA: BigInt(step.a),
      curveB: BigInt(step.b),
      pointX: BigInt(step.x),
      pointY: BigInt(step.y),
      orderPrime: BigInt(step.q),
    })),
  };
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
