// The numbers with a page of their own, built ahead of time: /is-prime/<n>
// (CLAUDE.md, “After completion”, prime checker step 5). Every other number is
// checked in the browser at /is-prime?n=. Plain data, so the checker's form
// (in the browser) can tell whether a number has its own page.

export interface ListedNumber {
  value: bigint;
  /** A line about why it's interesting, shown under the answer. */
  note?: string;
}

/**
 * Listed numbers have at most this many digits. Next writes each built page to a
 * file named after its number, and a file name can't be longer than 255 bytes.
 */
export const LISTED_MAX_DIGITS = 200;

/** Every whole number up to here: the most searched (“is 51 prime”). */
const EVERY_NUMBER_UP_TO = 1_000;
/** And the years from FIRST_YEAR to LAST_YEAR (“is 2027 prime”). */
const FIRST_YEAR = 1_900;
const LAST_YEAR = 2_100;

// Notes are site copy: curly quotes, and every claim checked.
const NOTABLE: readonly ListedNumber[] = [
  {
    value: 57n,
    note: "Called the Grothendieck prime: the mathematician Alexander Grothendieck is said to have offered it as an example of a prime. It isn’t one.",
  },
  { value: 73n, note: "Sheldon Cooper’s favourite number in The Big Bang Theory: the 21st prime, and 21 is 7 × 3." },
  {
    value: 561n,
    note: "The smallest Carmichael number: it passes Fermat’s test for every base that shares no factor with it, though it’s composite.",
  },
  { value: 1_729n, note: "The taxicab number: the smallest that’s the sum of two cubes in two ways, 1³ + 12³ and 9³ + 10³." },
  {
    value: 2_047n,
    note: "2¹¹ − 1, the first Mersenne number with a prime exponent that isn’t prime, and the smallest composite that passes Miller–Rabin with base 2 alone.",
  },
  { value: 65_537n, note: "2¹⁶ + 1, the largest known Fermat prime. Every Fermat number after it that’s been checked is composite." },
  { value: 1_000_003n, note: "The first prime after a million." },
  { value: 8_675_309n, note: "The phone number in Tommy Tutone’s 1981 song “867-5309/Jenny”. So is 8,675,311: a pair of twin primes." },
  { value: 123_456_789n, note: "Its digits add up to 45, a multiple of 3, so 3 divides it." },
  { value: 998_244_353n, note: "A favourite of competitive programmers: 119 × 2²³ + 1, which suits the number theoretic transform." },
  { value: 1_000_000_007n, note: "10⁹ + 7: the prime that competitive programming answers are usually given modulo." },
  { value: 2n ** 31n - 1n, note: "2³¹ − 1, the largest signed 32-bit integer. Euler proved it prime in 1772." },
  { value: 2n ** 32n + 1n, note: "2³² + 1, the Fermat number F₅. Fermat guessed that every such number was prime; Euler found the factor 641 in 1732." },
  {
    value: 3_215_031_751n,
    note: "The smallest composite that passes Miller–Rabin with all of the bases 2, 3, 5 and 7, though 151 divides it.",
  },
  { value: 600_851_475_143n, note: "Project Euler’s problem 3 asks for its largest prime factor." },
  { value: 2n ** 61n - 1n, note: "2⁶¹ − 1, a Mersenne prime found by Ivan Pervushin in 1883." },
  { value: 2n ** 64n - 59n, note: "2⁶⁴ − 59, the largest prime that fits in 64 bits." },
  { value: 12_345_678_901_234_567_891n, note: "1 to 9 and 0, then 1 to 9 again, then 1: and it’s prime." },
  {
    value: 2n ** 67n - 1n,
    note: "2⁶⁷ − 1. In 1903 Frank Nelson Cole showed it isn’t prime by working out 193,707,721 × 761,838,257,287 on a blackboard, without saying a word.",
  },
  {
    value: 3_317_044_064_679_887_385_961_981n,
    note: "The smallest composite that passes Miller–Rabin with all of the first 13 primes as bases. Past it, this site proves primes with elliptic curves.",
  },
  { value: 2n ** 89n - 1n, note: "2⁸⁹ − 1, a Mersenne prime found by R. E. Powers in 1911." },
  { value: 2n ** 107n - 1n, note: "2¹⁰⁷ − 1, a Mersenne prime found by R. E. Powers in 1914." },
  { value: 31_415_926_535_897_932_384_626_433_832_795_028_841n, note: "The first 38 digits of π, and prime." },
  {
    value: 2n ** 127n - 1n,
    note: "2¹²⁷ − 1. Édouard Lucas proved it prime by hand in 1876, and it stayed the largest known prime for 75 years.",
  },
  { value: 10n ** 100n, note: "A googol, named by nine-year-old Milton Sirotta. It’s even." },
  { value: 10n ** 100n + 267n, note: "The first prime after a googol." },
  { value: 2n ** 521n - 1n, note: "2⁵²¹ − 1, the first prime found by a computer program: Raphael Robinson’s, on the SWAC, on January 30, 1952." },
  { value: 2n ** 607n - 1n, note: "2⁶⁰⁷ − 1, found by Raphael Robinson’s program a few hours after 2⁵²¹ − 1, on January 30, 1952." },
];

let listed: ReadonlyMap<bigint, ListedNumber> | null = null;

/** Every listed number, keyed by value: 0 to 1,000, the years, and the notable ones. */
function listedByValue(): ReadonlyMap<bigint, ListedNumber> {
  if (listed) return listed;
  const byValue = new Map<bigint, ListedNumber>();
  for (let value = 0n; value <= BigInt(EVERY_NUMBER_UP_TO); value++) byValue.set(value, { value });
  for (let year = BigInt(FIRST_YEAR); year <= BigInt(LAST_YEAR); year++) byValue.set(year, { value: year });
  for (const notable of NOTABLE) byValue.set(notable.value, notable);
  listed = new Map([...byValue].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return listed;
}

/** Every listed number, in order. */
export function listedNumbers(): ListedNumber[] {
  return [...listedByValue().values()];
}

/** The listed entry for `value`, or undefined if it has no page of its own. */
export function listedNumber(value: bigint): ListedNumber | undefined {
  return listedByValue().get(value);
}

/** The listed numbers just before and after `value` (for the page's links), or null at either end. */
export function listedNeighbours(value: bigint): { previous: bigint | null; next: bigint | null } {
  const values = [...listedByValue().keys()];
  const index = values.indexOf(value);
  if (index === -1) return { previous: null, next: null };
  return { previous: index > 0 ? values[index - 1] : null, next: index + 1 < values.length ? values[index + 1] : null };
}

/** Where to send someone asking about `value`: its own page if it's listed, otherwise the checker's ?n=. */
export function isPrimeHref(value: bigint): string {
  return listedNumber(value) ? `/is-prime/${value}` : `/is-prime?n=${value}`;
}
