const EULER_MASCHERONI = 0.5772156649015329;
/** The series needs about 2·ln x terms: about 75 at 2^53, about 1,400 at 10^300. */
const MAX_SERIES_TERMS = 2000;
/**
 * Up to here li(x) is computed in doubles with Ramanujan's series. Past it,
 * li(x) itself wouldn't fit in a double (it overflows just above 10^308).
 */
const LARGEST_X_FOR_THE_SERIES = 10n ** 300n;
/** Significant digits a double holds, used to read the leading digits of a huge BigInt. */
const SIGNIFICANT_DIGITS_IN_A_DOUBLE = 17;

/**
 * ln(x), for numbers and BigInts of any size. Below 10^300 the BigInt is
 * converted to a double; above, ln comes from the leading digits and the
 * digit count: ln(d.ddd… × 10^k) = ln(d.ddd…) + k · ln 10.
 */
export function naturalLog(x: number | bigint): number {
  if (typeof x === "number" || x < LARGEST_X_FOR_THE_SERIES) return Math.log(Number(x));
  const digits = x.toString();
  const leadingDigits = Number(digits.slice(0, SIGNIFICANT_DIGITS_IN_A_DOUBLE));
  return Math.log(leadingDigits) + (digits.length - SIGNIFICANT_DIGITS_IN_A_DOUBLE) * Math.LN10;
}

/**
 * The logarithmic integral li(x) = ∫₀ˣ dt / ln t, for 1 < x < 10^300.
 *
 * li(x) is an excellent estimate of π(x), the number of primes ≤ x. At 10¹²
 * it's off by about 0.0001%, where x / ln x is off by about 4%.
 *
 * Uses Ramanujan's series, which converges quickly for every x:
 *
 *   li(x) = γ + ln ln x + √x · Σ_{n=1}^∞ [ (−1)^(n−1) (ln x)^n / (n! · 2^(n−1)) · Σ_{k=0}^{⌊(n−1)/2⌋} 1/(2k+1) ]
 *
 * For larger x (where li(x) won't fit in a double), use estimatePrimeOrdinal.
 */
export function logarithmicIntegral(x: number | bigint): number {
  if (typeof x === "bigint" && x >= LARGEST_X_FOR_THE_SERIES) {
    throw new RangeError("li(x) for x ≥ 10^300 doesn't fit in a double; use estimatePrimeOrdinal");
  }
  const xAsNumber = Number(x);
  if (!(xAsNumber > 1)) throw new RangeError(`logarithmicIntegral needs x > 1, got ${x}`);

  const lnX = Math.log(xAsNumber);
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

  return EULER_MASCHERONI + Math.log(lnX) + Math.sqrt(xAsNumber) * seriesSum;
}

/**
 * li(x) for x ≥ 10^300, as a BigInt, from the asymptotic expansion
 *
 *   li(x) ≈ (x / ln x) · Σ_{k=0}^{K} k! / (ln x)^k
 *
 * truncated at its smallest term (k ≈ ln x ≥ 690), where the error is far
 * below double precision. The sum is a double near 1 / ln x; it multiplies x
 * in BigInt as a 64-bit fixed-point fraction.
 */
export function logarithmicIntegralOfHugeNumber(x: bigint): bigint {
  const lnX = naturalLog(x);
  let term = 1 / lnX; // k! / (ln x)^(k+1), starting at k = 0
  let sumOverLnX = 0;
  for (let k = 0; ; k++) {
    sumOverLnX += term;
    const nextTerm = (term * (k + 1)) / lnX;
    if (nextTerm >= term || nextTerm < Number.EPSILON * sumOverLnX) break;
    term = nextTerm;
  }
  const FIXED_POINT_BITS = 64n;
  const sumAsFixedPoint = BigInt(Math.round(sumOverLnX * 2 ** 64));
  return (x * sumAsFixedPoint) >> FIXED_POINT_BITS;
}

/**
 * Estimates which prime `prime` is (2 is #1, 3 is #2, …) without counting
 * every prime below it: π(prime) ≈ li(prime), rounded to the nearest integer.
 */
export function estimatePrimeOrdinal(prime: bigint): bigint {
  if (prime >= LARGEST_X_FOR_THE_SERIES) return logarithmicIntegralOfHugeNumber(prime);
  // Beyond 2^53 the double is already a whole number, so BigInt() converts it exactly.
  return BigInt(Math.round(logarithmicIntegral(prime)));
}
