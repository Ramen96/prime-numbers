// The speed counter's reading. At one prime per second or more it's a rate:
// "1,234,567" primes per second. Below that, far past 3.3 × 10^24 where each
// prime needs a proof, a rate would read "0", so it shows the time each prime
// takes instead: "42 s", "3.5 min" per prime (step 5).

export interface RateReading {
  /** The big number on the counter. */
  value: string;
  /** What it counts, shown under it. */
  unit: "primes per second" | "per prime";
}

const RATE_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Seconds per unit, largest first. */
const DURATION_UNITS = [
  { seconds: 86_400, name: "days" },
  { seconds: 3_600, name: "h" },
  { seconds: 60, name: "min" },
  { seconds: 1, name: "s" },
] as const;

/** `primesPerSecond` as the counter shows it. */
export function describeRate(primesPerSecond: number): RateReading {
  if (primesPerSecond >= 1) return { value: RATE_FORMAT.format(primesPerSecond), unit: "primes per second" };
  return { value: formatDuration(1 / primesPerSecond), unit: "per prime" };
}

/**
 * A duration of at least a second, in the largest unit it fills: one decimal
 * below 10 ("1.4 s", "3.5 min"), whole numbers from there ("42 s", "17 h").
 */
export function formatDuration(seconds: number): string {
  const unit = DURATION_UNITS.find((candidate) => seconds >= candidate.seconds) ?? DURATION_UNITS.at(-1)!;
  const amount = seconds / unit.seconds;
  const rounded = amount < 10 ? Math.round(amount * 10) / 10 : Math.round(amount);
  // 9.96 rounds to 10.0: write it as 10, like any other amount from 10 up
  const text = rounded < 10 ? rounded.toFixed(1) : RATE_FORMAT.format(rounded);
  return `${text} ${unit.name}`;
}
