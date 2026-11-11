// Whole numbers with commas between groups of three digits, as
// Intl.NumberFormat("en-US") writes them, at any size (Requirement B).
//
// Intl.NumberFormat throws ("Internal error. Icu error.") for BigInts past
// about a million digits: Chromium 158 from 999,001, Node 26.13 from 1,000,000.
// Primes, their ordinals, jump targets and records can be any length, so they
// are formatted here. Plain numbers (speeds, byte and digit counts) stay far
// inside Intl's range and keep using it.

/** "1234567" → "1,234,567", for a BigInt of any size. */
export function formatWholeNumber(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const digits = (value < 0n ? -value : value).toString();
  const firstGroupLength = digits.length % 3 || 3;
  const groups = [digits.slice(0, firstGroupLength)];
  for (let start = firstGroupLength; start < digits.length; start += 3) groups.push(digits.slice(start, start + 3));
  return sign + groups.join(",");
}
