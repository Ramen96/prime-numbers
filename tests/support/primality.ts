// An independent primality check for tests (CLAUDE.md, Requirement A3),
// sharing no code with the sieve: Miller–Rabin in BigInt.
//
// With the first 13 primes (2 to 41) as bases it is deterministic, with no
// false "prime", for every n below 3,317,044,064,679,887,385,961,981.
// Source: OEIS A014233, a(13) = 3317044064679887385961981 (smallest strong
// pseudoprime to the first 13 prime bases), from J. Sorenson and J. Webster,
// "Strong Pseudoprimes to Twelve Prime Bases", Math. Comp. 86 (2017), 985–1003,
// https://arxiv.org/abs/1509.00864. Above that bound the answer is "probably
// prime" (and "composite" stays definitive: a witness proves it).

const WITNESSES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n];
export const DETERMINISTIC_BELOW = 3_317_044_064_679_887_385_961_981n;

function powerMod(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  base %= modulus;
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % modulus;
    base = (base * base) % modulus;
    exponent >>= 1n;
  }
  return result;
}

export function isPrime(candidate: bigint): boolean {
  if (candidate < 2n) return false;
  for (const witness of WITNESSES) {
    if (candidate % witness === 0n) return candidate === witness;
  }
  let oddPart = candidate - 1n;
  let powersOfTwo = 0;
  while ((oddPart & 1n) === 0n) {
    oddPart >>= 1n;
    powersOfTwo++;
  }
  witnesses: for (const witness of WITNESSES) {
    let value = powerMod(witness, oddPart, candidate);
    if (value === 1n || value === candidate - 1n) continue;
    for (let round = 1; round < powersOfTwo; round++) {
      value = (value * value) % candidate;
      if (value === candidate - 1n) continue witnesses;
    }
    return false;
  }
  return true;
}

/** The prime right after `value` (exact, any size within the bound above). */
export function nextPrimeAfter(value: bigint): bigint {
  let candidate = value + 1n;
  while (!isPrime(candidate)) candidate++;
  return candidate;
}

/** The prime right before `value`, or null below 3. */
export function previousPrimeBefore(value: bigint): bigint | null {
  for (let candidate = value - 1n; candidate >= 2n; candidate--) {
    if (isPrime(candidate)) return candidate;
  }
  return null;
}
