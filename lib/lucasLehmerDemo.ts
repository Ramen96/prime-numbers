// The Lucas–Lehmer demo on /mersenne-primes: s₀ = 4, then s(k+1) = (s(k)² − 2)
// mod 2ᵖ − 1, for p − 2 steps; 2ᵖ − 1 is prime exactly when the last is 0 (for
// an odd prime p). BigInt, though the demo stops at p = 31 (so every value is
// below 2³¹ and every line stays short): 2ᵖ − 1 for p up to 31 also fits in a
// number, which is how the composite ones are factored for the last sentence.

/** The exponents the demo offers: the odd primes up to 31 (the test needs an odd prime p). */
export const LUCAS_LEHMER_DEMO_EXPONENTS = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31] as const;
/** What it starts on, and the answer the page is built with. */
export const LUCAS_LEHMER_DEMO_START = 7;

export interface LucasLehmerRun {
  exponent: number;
  /** 2ᵖ − 1. */
  mersenne: bigint;
  /** s₀ = 4, s₁, …, s(p−2). */
  terms: bigint[];
  prime: boolean;
  /** The prime factors of a composite 2ᵖ − 1, smallest first; empty for a prime. */
  factors: bigint[];
}

/** The prime factors of `value`, smallest first, by trial division (the demo's numbers are below 2³¹). */
function primeFactors(value: bigint): bigint[] {
  const factors: bigint[] = [];
  let rest = value;
  for (let divisor = 2n; divisor * divisor <= rest; divisor++) {
    while (rest % divisor === 0n) {
      factors.push(divisor);
      rest /= divisor;
    }
  }
  if (rest > 1n) factors.push(rest);
  return factors;
}

export function lucasLehmer(exponent: number): LucasLehmerRun {
  if (!(LUCAS_LEHMER_DEMO_EXPONENTS as readonly number[]).includes(exponent))
    throw new RangeError(`The demo runs for p in ${LUCAS_LEHMER_DEMO_EXPONENTS.join(", ")}, not ${exponent}`);
  const mersenne = 2n ** BigInt(exponent) - 1n;
  const terms = [4n];
  for (let step = 1; step <= exponent - 2; step++) {
    const previous = terms[step - 1];
    terms.push((previous * previous - 2n) % mersenne);
  }
  const prime = terms[terms.length - 1] === 0n;
  return { exponent, mersenne, terms, prime, factors: prime ? [] : primeFactors(mersenne) };
}

const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";
const SUPERSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const subscript = (value: number) => [...String(value)].map((digit) => SUBSCRIPT_DIGITS[Number(digit)]).join("");
const superscript = (value: number) => [...String(value)].map((digit) => SUPERSCRIPT_DIGITS[Number(digit)]).join("");
const formatted = (value: bigint) => value.toLocaleString("en-US");

/** “s₀ = 4”, then “s₁ = (4² − 2) mod 127 = 14”. */
export function describeTerm(run: LucasLehmerRun, step: number): string {
  if (step === 0) return `s${subscript(0)} = ${formatted(run.terms[0])}`;
  return `s${subscript(step)} = (${formatted(run.terms[step - 1])}² − 2) mod ${formatted(run.mersenne)} = ${formatted(run.terms[step])}`;
}

/** The demo's answer. */
export function lucasLehmerConclusion(run: LucasLehmerRun): string {
  const steps = run.exponent - 2;
  const after = `After ${steps} ${steps === 1 ? "step" : "steps"} the remainder is`;
  const number = `2${superscript(run.exponent)} − 1 = ${formatted(run.mersenne)}`;
  if (run.prime) return `${after} 0, so ${number} is prime.`;
  const last = run.terms[run.terms.length - 1];
  return `${after} ${formatted(last)}, not 0, so ${number} isn’t prime. The test doesn’t say what its factors are: they’re ${run.factors.map(formatted).join(" × ")}.`;
}
