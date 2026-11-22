// What the check-a-certificate box says (random-prime page): decided here, from
// what readCertificate read and what checkCertificate found, so it can be tested.

import { formatWholeNumber } from "./formatNumber.ts";
import type { ReadCertificate } from "./certificateExport.ts";
import type { CertificateCheck, CertificateStep } from "./primes/primalityCertificate.ts";

/** "6,282,635,265,…,546,735,707": a long number's first and last digit groups, for one line. */
export function shortNumber(value: bigint): string {
  const groups = formatWholeNumber(value).split(",");
  return groups.length <= 8 ? groups.join(",") : `${groups.slice(0, 4).join(",")},…,${groups.slice(-3).join(",")}`;
}

/** Which step a failed check is about (0-based), or null when it's the chain's end. */
function failingStepIndex(prime: bigint, steps: readonly CertificateStep[], check: Extract<CertificateCheck, { valid: false }>) {
  // walk the chain as the checker does: the first step whose N isn't the number it should be
  let expected = prime;
  for (const [index, step] of steps.entries()) {
    if (step.number !== expected) return index;
    if (step.number === check.number && check.reason !== "the chain is broken") return index;
    expected = step.orderPrime;
  }
  return null;
}

/** The result line for a certificate that was read and checked. */
export function describeCheck(prime: bigint, steps: readonly CertificateStep[], check: CertificateCheck): string {
  if (check.valid)
    return `Valid: this certificate proves the ${formatWholeNumber(BigInt(prime.toString().length))}-digit number ${shortNumber(prime)} prime.`;
  const index = failingStepIndex(prime, steps, check);
  if (index === null)
    return `Not valid: the last step’s q, ${shortNumber(check.number)}, isn’t proven prime (it has to be below 3.3 × 10²⁴).`;
  if (index === 0 && steps[0].number !== prime)
    return "Not valid: step 1’s N isn’t the number the certificate is for.";
  if (check.reason === "the chain is broken")
    return `Not valid: step ${index + 1} of ${steps.length} doesn’t continue the chain (its N isn’t step ${index}’s q).`;
  return `Not valid: step ${index + 1} of ${steps.length} doesn’t hold (${check.reason}).`;
}

/** The result line for one that couldn't be read. */
export function describeUnreadable(read: Extract<ReadCertificate, { readable: false }>): string {
  return `That isn’t a certificate this page can read: ${read.reason}.`;
}
