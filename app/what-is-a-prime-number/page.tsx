import Link from "next/link";
import { pageMetadata } from "@/lib/pageMetadata";
import { Article } from "../components/Article";
import { DotRectangles, FactorTree } from "../components/PrimeFigures";
import { PrimesTo100 } from "../components/PrimesTo100";
import { SieveDemo } from "../components/SieveDemo";

// The first explainer (CLAUDE.md, “After completion”, SEO step 2c): for
// students, teachers and the curious, not programmers. Plain text, two
// figures, the primes to 100 and the sieve demo, every number linking to its
// checker page. /how-it-works keeps the programmer's version.

export const metadata = pageMetadata({
  title: "What is a prime number? Definition, examples and the primes to 100 | Every Prime Number",
  description:
    "A prime number is a whole number above 1 that only 1 and itself divide. Examples, the 25 primes from 1 to 100, why 1 isn’t prime, and how to find primes.",
  path: "/what-is-a-prime-number",
});

export default function WhatIsAPrimeNumberPage() {
  return (
    <Article
      title="What is a prime number?"
      lead="A prime number is a whole number greater than 1 that can only be divided evenly by 1 and itself."
    >
      <h2 id="examples">Prime numbers, with examples</h2>
      <p>
        <Link href="/is-prime/7">7</Link> is prime: the only whole numbers that divide it evenly are 1 and 7.{" "}
        <Link href="/is-prime/12">12</Link> isn’t: 2, 3, 4 and 6 divide it too. A whole number above 1 that isn’t prime
        is called <strong>composite</strong>, so every whole number from 2 up is one or the other. 1 is neither.
      </p>
      <p>The first ten primes are 2, 3, 5, 7, 11, 13, 17, 19, 23 and 29.</p>

      <h3 id="picture-it-with-dots">Picture it with dots</h3>
      <p>
        Try arranging some dots into a neat rectangle with more than one row. Twelve dots can make 2 rows of 6, or 3
        rows of 4. Seven dots can’t: whatever you try, a single row is the only way. A prime is a number of dots that
        only fits in one row.
      </p>
      <DotRectangles />

      <h2 id="primes-1-to-100">The prime numbers from 1 to 100</h2>
      <p>
        There are 25 of them: 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83,
        89 and 97. In the grid, the primes are in bold and coloured. Click or tap any number to see why it is or isn’t
        prime.
      </p>
      <PrimesTo100 />

      <h2 id="common-questions">Common questions</h2>
      <h3 id="is-1-prime">Is 1 a prime number?</h3>
      <p>
        No. A prime needs exactly two divisors, 1 and itself, and 1 has only one. There’s a deeper reason too:{" "}
        <Link href="/fun-facts#why-1-isnt-prime">see why 1 isn’t prime</Link>.
      </p>
      <h3 id="is-2-prime">Is 2 a prime number?</h3>
      <p>
        <Link href="/is-prime/2">Yes</Link>. It’s the smallest prime and the only even one: every other even number can
        be divided by 2.
      </p>
      <h3 id="is-0-prime">Is 0 a prime number?</h3>
      <p>
        No. Every whole number divides 0 evenly, so it has far more than two divisors. Like 1, it’s neither prime nor
        composite.
      </p>
      <h3 id="negative-primes">Can a negative number be prime?</h3>
      <p>
        Not in the usual sense: primes are whole numbers greater than 1. In some advanced mathematics −7 counts as a
        prime too, but school maths and this site use the usual sense.
      </p>
      <h3 id="largest-prime">What is the largest prime number?</h3>
      <p>
        There isn’t one: the primes go on forever. There is a largest <em>known</em> prime, found by computers searching
        for special primes called <Link href="/fun-facts#mersenne-primes">Mersenne primes</Link>.
      </p>

      <h2 id="prime-factorization">Primes are the building blocks of numbers</h2>
      <p>
        Every whole number above 1 can be written as primes multiplied together, in exactly one way apart from the
        order. That’s its <strong>prime factorization</strong>. To find it, keep splitting a number into two factors
        until every piece is prime:
      </p>
      <FactorTree />
      <p>
        So 60 = 2 × 2 × 3 × 5. Start with 4 × 15 instead and you end up with the same four primes. That’s why primes
        are sometimes called the atoms of arithmetic.
      </p>

      <h2 id="sieve-of-eratosthenes">How to find prime numbers: the sieve of Eratosthenes</h2>
      <p>
        More than 2,000 years ago, the Greek mathematician Eratosthenes found a way to list primes without dividing
        anything. Write out the numbers from 2 up. Circle 2, then cross out every other multiple of 2. The next number
        not crossed out is 3: circle it and cross out its multiples. Keep going. Every number left uncrossed is prime.
      </p>
      <p>Try it: step through the sieve up to 120.</p>
      <SieveDemo />
      <p>
        This site uses the same idea, in smaller pieces, to find primes as you scroll.{" "}
        <Link href="/how-it-works#sieve-of-eratosthenes">How it does that →</Link>
      </p>

      <h2 id="look-prime-but-arent">Numbers that look prime but aren’t</h2>
      <p>
        Odd numbers that don’t end in 5 can still be composite. A few that catch people out:{" "}
        <Link href="/is-prime/51">51</Link> = 3 × 17, <Link href="/is-prime/57">57</Link> = 3 × 19 and{" "}
        <Link href="/is-prime/91">91</Link> = 7 × 13. 57 is even nicknamed the Grothendieck prime, after a famous
        mathematician who is said to have offered it as an example of one. For 3 there’s a shortcut: add up the digits,
        and if the total divides by 3, so does the number. 5 + 1 = 6, so 3 divides 51.
      </p>
      <p>
        More shortcuts like this: <Link href="/how-to-tell-if-a-number-is-prime">How to tell if a number is prime →</Link>
      </p>

      <h2 id="how-many-primes">How many prime numbers are there?</h2>
      <p>
        Infinitely many. <Link href="/fun-facts#infinitely-many-primes">Euclid proved it</Link> around 300 BC with an
        argument short enough to fit on a napkin. They do get rarer: 25 of the numbers up to 100 are prime, but only
        168 up to 1,000. This site’s <Link href="/">home page</Link> lists them one after another, as far as your
        computer can keep up.
      </p>

      <h2 id="more">More about primes</h2>
      <ul>
        <li>
          <Link href="/is-prime">Is your number prime? Check it →</Link>
        </li>
        <li>
          <Link href="/how-to-tell-if-a-number-is-prime">How to tell if a number is prime →</Link>
        </li>
        <li>
          <Link href="/fun-facts">Fun facts about prime numbers →</Link>
        </li>
        <li>
          <Link href="/how-it-works">How this site finds primes →</Link>
        </li>
      </ul>
    </Article>
  );
}
