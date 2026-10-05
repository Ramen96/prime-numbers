const EULER_MASCHERONI = 0.5772156649015329;
/** Far more than needed: the series converges in well under 100 terms for any x up to 2^53. */
const MAX_SERIES_TERMS = 200;

/**
 * The logarithmic integral li(x) = ∫₀ˣ dt / ln t, for x > 1.
 *
 * li(x) is an excellent estimate of π(x), the number of primes ≤ x. At 10¹²
 * it's off by about 0.0001%, where x / ln x is off by about 4%.
 *
 * Uses Ramanujan's series, which converges quickly for every x:
 *
 *   li(x) = γ + ln ln x + √x · Σ_{n=1}^∞ [ (−1)^(n−1) (ln x)^n / (n! · 2^(n−1)) · Σ_{k=0}^{⌊(n−1)/2⌋} 1/(2k+1) ]
 */
export function logarithmicIntegral(x: number): number {
  if (!(x > 1)) throw new RangeError(`logarithmicIntegral needs x > 1, got ${x}`);

  const lnX = Math.log(x);
  let seriesSum = 0;
  /** (ln x)^n / (n! · 2^(n−1)), built up one term at a time to avoid huge powers and factorials. */
  let powerOverFactorial = 1;
  /** 1 + 1/3 + 1/5 + … up to 1/(2k+1) where k = ⌊(n−1)/2⌋. */
  let oddReciprocalSum = 0;

  for (let termIndex = 1; termIndex <= MAX_SERIES_TERMS; termIndex++) {
    powerOverFactorial *= termIndex === 1 ? lnX : lnX / (2 * termIndex);
    // The inner sum gains a new 1/(2k+1) term exactly when termIndex is odd (2k+1 = termIndex).
    if (termIndex % 2 === 1) oddReciprocalSum += 1 / termIndex;

    const sign = termIndex % 2 === 1 ? 1 : -1;
    const term = sign * powerOverFactorial * oddReciprocalSum;
    seriesSum += term;

    // Terms grow until termIndex ≈ ln x, then shrink fast. Stop once they're negligible.
    const pastPeak = termIndex > lnX;
    if (pastPeak && Math.abs(term) < Number.EPSILON * Math.abs(seriesSum)) break;
  }

  return EULER_MASCHERONI + Math.log(lnX) + Math.sqrt(x) * seriesSum;
}

/**
 * Estimates which prime `prime` is (2 is #1, 3 is #2, …) without counting
 * every prime below it: π(prime) ≈ li(prime), rounded to the nearest integer.
 */
export function estimatePrimeOrdinal(prime: number): number {
  return Math.round(logarithmicIntegral(prime));
}
