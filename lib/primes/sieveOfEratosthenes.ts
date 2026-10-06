// The plain (unsegmented) sieve of Eratosthenes. Used on the server at build
// time: for the first batch rendered into the home page's HTML and for the
// Ulam spiral on /how-it-works. The browser uses the worker instead.

/** A table where isPrime[n] is 1 if n is prime, for every n < limit. */
export function primalityTableBelow(limit: number): Uint8Array {
  const isPrime = new Uint8Array(Math.max(limit, 0)).fill(1);
  isPrime[0] = 0;
  if (limit > 1) isPrime[1] = 0;
  for (let candidate = 2; candidate * candidate < limit; candidate++) {
    if (!isPrime[candidate]) continue;
    // Smaller multiples were already crossed off by smaller primes.
    for (let multiple = candidate * candidate; multiple < limit; multiple += candidate) {
      isPrime[multiple] = 0;
    }
  }
  return isPrime;
}

/** The first `count` primes: 2, 3, 5, 7, … */
export function firstPrimes(count: number): number[] {
  // The n-th prime is below n(ln n + ln ln n) for n ≥ 6, so sieve that far.
  const limit = count < 6 ? 15 : Math.ceil(count * (Math.log(count) + Math.log(Math.log(count))));
  const isPrime = primalityTableBelow(limit);
  const primes: number[] = [];
  for (let candidate = 2; candidate < limit && primes.length < count; candidate++) {
    if (isPrime[candidate]) primes.push(candidate);
  }
  return primes;
}
