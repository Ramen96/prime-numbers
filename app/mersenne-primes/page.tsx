import Link from "next/link";
import { isPrimeHref } from "@/lib/listedNumbers";
import { lucasLehmer } from "@/lib/lucasLehmerDemo";
import { pageMetadata } from "@/lib/pageMetadata";
import { Article } from "../components/Article";
import { LucasLehmerDemo } from "../components/LucasLehmerDemo";
import { ScrollableTable } from "../components/ScrollableTable";

// The third explainer (CLAUDE.md, “After completion”, SEO step 2c): Mersenne
// primes for the curious, with the Lucas–Lehmer test as a demo. Every number in
// the table is computed (lucasLehmer, which factors the composite ones), not typed.

export const metadata = pageMetadata({
  title: "What is a Mersenne prime? Definition, list and the Lucas–Lehmer test | Every Prime Number",
  description:
    "A Mersenne prime is a prime of the form 2ᵖ − 1, like 3, 7, 31 and 127. Why p must be prime, which ones are, how the Lucas–Lehmer test finds record primes, and their link to perfect numbers.",
  path: "/mersenne-primes",
});

/** The prime exponents in the table: 2 (which the test doesn't cover, 2² − 1 = 3), then the demo's. */
const TABLE_EXPONENTS = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31] as const;

const M127 = 2n ** 127n - 1n;
const M521 = 2n ** 521n - 1n;
const M607 = 2n ** 607n - 1n;

function MersenneTable() {
  const rows = [
    { exponent: 2, mersenne: 3n, factors: [] as bigint[] },
    ...TABLE_EXPONENTS.map((exponent) => lucasLehmer(exponent)),
  ];
  return (
    <ScrollableTable label="The Mersenne numbers up to 2³¹ − 1">
      <table data-testid="mersenne-table">
        <thead>
          <tr>
            <th>p</th>
            <th>2ᵖ − 1</th>
            <th>
              <span className="sr-only">Prime or its factors</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ exponent, mersenne, factors }) => (
            <tr key={exponent}>
              <td>{exponent}</td>
              <td>
                <Link href={isPrimeHref(mersenne)}>{mersenne.toLocaleString("en-US")}</Link>
              </td>
              <td>{factors.length === 0 ? "prime" : factors.map((factor) => factor.toLocaleString("en-US")).join(" × ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollableTable>
  );
}

export default function MersennePrimesPage() {
  return (
    <Article
      title="What is a Mersenne prime?"
      lead="A Mersenne prime is a prime number that’s one less than a power of two: 2ᵖ − 1. 3, 7, 31 and 127 are the first four."
    >
      <h2 id="powers-of-two-minus-one">Powers of two, minus one</h2>
      <p>
        Take a power of two and subtract 1: 2² − 1 = 3, 2³ − 1 = 7, 2⁴ − 1 = 15, 2⁵ − 1 = 31. These are the Mersenne
        numbers, and the ones that are prime are the Mersenne primes.
      </p>
      <p>
        The power has to be prime for the result to be prime. 2⁴ − 1 = 15 = 3 × 5, 2⁶ − 1 = 63 = 7 × 9 and 2⁹ − 1 =
        511 = 7 × 73. Whenever the power splits as a × b, 2ᵃ − 1 divides the result: 2³ − 1 = 7 divides both 63 and 511.
      </p>
      <p>
        A prime power isn’t enough, though. 2¹¹ − 1 = <Link href="/is-prime/2047">2,047</Link> = 23 × 89.
      </p>

      <h2 id="mersenne-numbers-up-to-2-31">The Mersenne numbers up to 2³¹ − 1</h2>
      <MersenneTable />
      <p>
        The factors follow a pattern too. Every factor of 2ᵖ − 1 is one more than a multiple of 2p: 23 = 2 × 11 + 1 and
        89 = 8 × 11 + 1. That narrows down a lot where anyone hunting for factors has to look.
      </p>

      <h2 id="binary">In binary, a row of ones</h2>
      <p>
        In binary, 2ᵖ − 1 is p ones in a row: 127 is 1111111. That’s why these numbers keep turning up in computing.{" "}
        <Link href={isPrimeHref(2n ** 31n - 1n)}>2³¹ − 1</Link>, 2,147,483,647, is the largest number a signed 32-bit
        integer can hold, and Euler proved it prime in 1772. <Link href={isPrimeHref(2n ** 61n - 1n)}>2⁶¹ − 1</Link> is
        popular in hashing, and Ivan Pervushin proved it prime in 1883.
      </p>

      <h2 id="lucas-lehmer-test">The Lucas–Lehmer test</h2>
      <p>
        Mersenne numbers have a primality test all of their own, and it’s remarkably simple. Start with 4. Then, again
        and again, square the number, subtract 2, and keep only the remainder when you divide by 2ᵖ − 1. After p − 2
        steps, the remainder is 0 if 2ᵖ − 1 is prime, and something else if it isn’t.
      </p>
      <p>For p = 7, that’s 4, 14, 67, 42, 111, 0, so 127 is prime. Try it:</p>
      <LucasLehmerDemo />
      <p>
        It needs only p − 2 squarings, and computers can multiply huge numbers very quickly. No test like it is known
        for numbers in general. That’s why the largest known primes are almost all Mersenne primes, and why this site
        has to build a <Link href="/how-it-works#proving-huge-primes">certificate</Link>, step by step, for each large
        prime it finds.
      </p>

      <h2 id="history">A short history</h2>
      <p>
        In 1644 the French friar Marin Mersenne listed the powers up to 257 that he believed gave primes. He was wrong
        about 67 and 257, and he missed 61, 89 and 107, but his name stuck. In 1876 Édouard Lucas proved{" "}
        <Link href={isPrimeHref(M127)}>2¹²⁷ − 1</Link> prime by hand, and it stayed the largest known prime for 75
        years. Lucas’s method became the test above, which Derrick Henry Lehmer gave its modern form in 1930. In 1903,
        Frank Nelson Cole showed that <Link href={isPrimeHref(2n ** 67n - 1n)}>2⁶⁷ − 1</Link> isn’t prime by
        multiplying out its two factors on a blackboard, without saying a word. And on January 30, 1952, Raphael
        Robinson’s program on the SWAC found <Link href={isPrimeHref(M521)}>2⁵²¹ − 1</Link> and then{" "}
        <Link href={isPrimeHref(M607)}>2⁶⁰⁷ − 1</Link>, the first primes ever found by a computer.
      </p>

      <h2 id="largest-known-prime">The largest known prime</h2>
      {/*
        TODO(owner): verify the current record before adding specifics (the same as on /fun-facts). Claim to check:
          - the largest known prime (as 2^p − 1, i.e. the exponent p),
          - its number of decimal digits,
          - its discovery date,
          - source: GIMPS, https://www.mersenne.org/
        Then replace the general sentence below with the verified figures.
      */}
      <p>
        Since 1996, the record holders have been found by the Great Internet Mersenne Prime Search (GIMPS), a volunteer
        project running on thousands of ordinary computers. The current record is listed at{" "}
        <a href="https://www.mersenne.org/" rel="noopener noreferrer">
          mersenne.org
        </a>
        . It has millions of digits.
      </p>
      <p>
        This site’s list can get you to some of the smaller ones:{" "}
        <Link href={`/?jump=${M127}`}>jump to 2¹²⁷ − 1 →</Link>, which takes seconds, or{" "}
        <Link href={`/?jump=${M521}`}>jump to 2⁵²¹ − 1 →</Link>, which goes slower, one proof at a time. The record is a
        little further.
      </p>

      <h2 id="perfect-numbers">Perfect numbers</h2>
      <p>
        A perfect number is one that equals the sum of its other divisors: 6 = 1 + 2 + 3, and 28 = 1 + 2 + 4 + 7 + 14.
        Every Mersenne prime gives one: 2<sup>p−1</sup> × (2ᵖ − 1). That makes 6, 28, 496 and 8,128 from 3, 7, 31 and
        127. Euclid proved this around 300 BC. About 2,000 years later, Euler proved the reverse: every even perfect
        number comes from a Mersenne prime. No odd perfect number has ever been found, and nobody has proved there isn’t
        one.
      </p>

      <h2 id="common-questions">Common questions</h2>
      <h3 id="infinitely-many">Are there infinitely many Mersenne primes?</h3>
      <p>
        Nobody knows. Most mathematicians expect so, but it’s never been proved, unlike for the{" "}
        <Link href="/fun-facts#infinitely-many-primes">primes themselves</Link>.
      </p>
      <h3 id="prime-exponent-enough">Is 2ᵖ − 1 prime whenever p is prime?</h3>
      <p>
        No. p being prime is needed but not enough: 2¹¹ − 1 = 2,047 = 23 × 89, and 2²³ − 1 and 2²⁹ − 1 aren’t prime
        either.
      </p>
      <h3 id="why-largest-are-mersenne">Why are the largest known primes Mersenne primes?</h3>
      <p>
        Because of the Lucas–Lehmer test. Checking a Mersenne number takes far less work than checking any other number
        its size, so the searches with the most computing power look there.
      </p>
      <h3 id="help-find-one">Can I help find the next one?</h3>
      <p>
        Yes. Anyone can run GIMPS’s free software on their own computer, at{" "}
        <a href="https://www.mersenne.org/" rel="noopener noreferrer">
          mersenne.org
        </a>
        .
      </p>

      <h2 id="more">More about primes</h2>
      <ul>
        <li>
          <Link href="/what-is-a-prime-number">What is a prime number? →</Link>
        </li>
        <li>
          <Link href="/how-to-tell-if-a-number-is-prime">How to tell if a number is prime →</Link>
        </li>
        <li>
          <Link href="/fun-facts">Fun facts about prime numbers →</Link>
        </li>
        <li>
          <Link href="/is-prime">Is your number prime? Check it →</Link>
        </li>
      </ul>
    </Article>
  );
}
