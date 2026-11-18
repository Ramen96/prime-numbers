// The text of the “proving primality…” row (step 5): what the list is waiting
// on while a prime past 3.3 × 10^24 is being proven. It's decided here, so it's
// easy to test and the row only draws it.

import { formatWholeNumber } from "./formatNumber.ts";
import { formatDuration } from "./formatRate.ts";

/** What the worker last said about the proof the list is waiting on. */
export interface ProvingStatus {
  /** How long the list has waited on this prime. */
  elapsedMs: number;
  /** Its digits, once the worker has said; null just after proving starts. */
  digits: number | null;
  /** About how many digits the number its chain has reached has (null with `digits`). */
  reachedDigits: number | null;
}

export const PROVING_TEXT = "proving primality…";

/**
 * "proving primality…", then from a second in, how long it's taken ("12 s"),
 * and once the chain has gone down, how far: "down to 63 of 100 digits".
 */
export function describeProving({ elapsedMs, digits, reachedDigits }: ProvingStatus): string {
  const parts: string[] = [];
  if (elapsedMs >= 1000) parts.push(formatDuration(elapsedMs / 1000));
  if (digits !== null && reachedDigits !== null && reachedDigits < digits) {
    parts.push(`down to ${formatWholeNumber(BigInt(reachedDigits))} of ${formatWholeNumber(BigInt(digits))} digits`);
  }
  return parts.length === 0 ? PROVING_TEXT : `${PROVING_TEXT} ${parts.join(", ")}`;
}
