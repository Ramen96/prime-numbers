import Link from "next/link";
import { pageMetadata } from "@/lib/pageMetadata";
import { Article } from "../components/Article";
import { FactorPairs } from "../components/PrimeFigures";
import { ScrollableTable } from "../components/ScrollableTable";
import { TrialDivisionDemo } from "../components/TrialDivisionDemo";

// The second explainer (CLAUDE.md, “After completion”, SEO step 2c): how to
// check a number by hand, with the divisibility rules, trial division and its
// demo, then gently how computers check huge numbers. For the same readers as
// /what-is-a-prime-number; /how-it-works keeps the programmer's version.

export const metadata = pageMetadata({
  title: "How to tell if a number is prime: divisibility rules and the square root trick | Every Prime Number",
  description:
    "Try dividing by the primes up to its square root. Quick divisibility rules for 2, 3, 5, 7 and 11, worked examples, and how computers check numbers with hundreds of digits.",
  path: "/how-to-tell-if-a-number-is-prime",
});

const RULES: { divisor: number; rule: string; example: string }[] = [
  { divisor: 2, rule: "the last digit is 0, 2, 4, 6 or 8", example: "358 ends in 8" },
  { divisor: 3, rule: "its digits add up to a multiple of 3", example: "51: 5 + 1 = 6" },
  { divisor: 5, rule: "the last digit is 0 or 5", example: "1,115 ends in 5" },
  {
    divisor: 7,
    rule: "doubling the last digit and subtracting it from the rest leaves a multiple of 7",
    example: "203: 20 − 2 × 3 = 14",
  },
  {
    divisor: 11,
    rule: "adding and subtracting the digits in turn leaves a multiple of 11 (0 counts)",
    example: "1,001: 1 − 0 + 0 − 1 = 0",
  },
];

export default function HowToTellIfANumberIsPrimePage() {
  return (
    <Article
      title="How to tell if a number is prime"
      lead="To tell if a whole number above 1 is prime, try dividing it by each prime up to its square root. If none of them divides it evenly, it’s prime."
    >
      <h2 id="divisibility-rules">Quick checks first: divisibility rules</h2>
      <p>
        Before dividing anything, a few rules catch most composite numbers at a glance. If one of these says a number
        divides by something and the number isn’t that something itself, it isn’t prime.
      </p>
      <ScrollableTable label="Divisibility rules">
        <table>
          <thead>
            <tr>
              <th>Divides by</th>
              <th>If…</th>
              <th>Example</th>
            </tr>
          </thead>
          <tbody>
            {RULES.map(({ divisor, rule, example }) => (
              <tr key={divisor}>
                <td>{divisor}</td>
                <td>{rule}</td>
                <td>{example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
      <p>
        The rules for 7 and 11 can be repeated on a long number until it’s small enough to see. Passing all five
        doesn’t make a number prime, though. <Link href="/is-prime/221">221</Link> passes every one, and it’s still 13 ×
        17.
      </p>

      <h2 id="trial-division">Trial division, and why you can stop at the square root</h2>
      <p>
        The sure way is to divide. Try each prime in turn: 2, 3, 5, 7, 11 and so on. If one divides the number evenly,
        you’ve found a factor, and the number isn’t prime.
      </p>
      <p>
        You never have to try past the square root. Factors come in pairs that multiply to the number, and in every
        pair one of them is at most the square root. Take 36:
      </p>
      <FactorPairs />
      <p>
        So if nothing up to the square root divides a number, nothing above it can either. You only need to try
        primes, too: if 4 divided the number, 2 would already have.
      </p>

      <h2 id="try-it">Try it</h2>
      <p>
        Type a number from 2 to 10,000. The demo divides it by each prime up to its square root, showing the remainder,
        until one divides it evenly or the primes run out.
      </p>
      <TrialDivisionDemo />

      <h2 id="worked-examples">Worked examples</h2>
      <p>
        <strong>
          <Link href="/is-prime/97">97</Link>.
        </strong>{" "}
        √97 ≈ 9.8, so try 2, 3, 5 and 7. 97 is odd, its digits add up to 16, it doesn’t end in 0 or 5, and 97 ÷ 7
        leaves 6. Nothing divides it: 97 is prime.
      </p>
      <p>
        <strong>
          <Link href="/is-prime/91">91</Link>.
        </strong>{" "}
        √91 ≈ 9.5. 2, 3 and 5 don’t divide it, but 7 does: 91 = 7 × 13. It’s one of the numbers that most often get
        mistaken for a prime.
      </p>
      <p>
        <strong>
          <Link href="/is-prime/221">221</Link>.
        </strong>{" "}
        √221 ≈ 14.9, so the primes to try go up to 13. Every quick rule passes, and 2, 3, 5, 7 and 11 all leave a
        remainder. Then 13 divides it: 221 = 13 × 17. Composites with two fairly close factors are the hardest to spot by
        eye.
      </p>

      <h2 id="big-numbers">Why big numbers need something cleverer</h2>
      <p>
        Trial division is fine for small numbers, but it slows down fast. A 30-digit number has about 30 trillion primes
        below its square root. At a billion divisions a second, trying them all takes about eight hours. For a 100-digit
        number it would take far longer than the age of the universe. So computers use tests that never look for a
        factor at all.
      </p>
      <p>
        <strong>Fermat’s test.</strong> Pierre de Fermat noticed that if p is prime, then for any a that p doesn’t
        divide, a<sup>p−1</sup> leaves a remainder of 1 when divided by p. Computers can work that out quickly, even for
        huge numbers. 2⁹⁶ divided by 97 leaves 1, as it must. 2⁹⁰ divided by 91 leaves 64, so 91 can’t be prime, and the
        test shows it without finding 7 or 13. But a few composites pass. <Link href="/is-prime/341">341</Link> = 11 ×
        31 passes with a = 2, though a = 3 catches it. And <Link href="/is-prime/561">561</Link>, a{" "}
        <Link href="/fun-facts#carmichael-numbers">Carmichael number</Link>, passes for every a that shares no factor
        with it.
      </p>
      <p>
        <strong>Miller–Rabin.</strong> A sharper version of the same idea catches every Carmichael number. For numbers
        below about 3.3 × 10²⁴, mathematicians have worked out a short list of values of a that together catch every
        composite. So below that size, passing the test counts as proof. That rests on a published computation. This is
        how this site checks most of the numbers you’ll see.
      </p>
      <p>
        <strong>Proofs for huge numbers.</strong> Past that size, a number that passes is only <em>almost certainly</em>{" "}
        prime. To be sure, this site builds a primality certificate with elliptic curves: a chain of facts that proves the
        number prime, and that a separate, simpler program can check.{" "}
        <Link href="/how-it-works#proving-huge-primes">How that works →</Link>{" "}
        <Link href="/random-prime">See one for a random prime →</Link>
      </p>

      <h2 id="common-questions">Common questions</h2>
      <h3 id="formula-for-primes">Is there a formula that gives every prime?</h3>
      <p>
        Not a practical one. Some formulas give a lot of primes for a while. Euler’s n² + n + 41 is prime for every n
        from 0 to 39. But at n = 40 it gives 1,681, which is 41 × 41. No simple formula is known that gives only primes,
        let alone all of them.
      </p>
      <h3 id="ending-in-1-3-7-9">Is a number ending in 1, 3, 7 or 9 always prime?</h3>
      <p>
        No. Ending in one of those only rules out 2 and 5 as factors. <Link href="/is-prime/21">21</Link> = 3 × 7,{" "}
        <Link href="/is-prime/49">49</Link> = 7 × 7 and <Link href="/is-prime/77">77</Link> = 7 × 11 all end that way.
      </p>
      <h3 id="only-primes">Do I need to try dividing by 4, 6, 8 or 9?</h3>
      <p>
        No. Any number they divide, 2 or 3 divides too, so you’d already have found a factor. Only primes need trying.
      </p>
      <h3 id="fastest-way">What’s the fastest way to check a big number?</h3>
      <p>
        Type it into the <Link href="/is-prime">prime checker</Link>. It answers at once for most numbers, and can prove
        primes with hundreds of digits in your browser.
      </p>
      <h3 id="largest-known-primes">How are the largest known primes found?</h3>
      <p>
        They’re <Link href="/mersenne-primes">Mersenne primes</Link>, numbers of the form 2ⁿ − 1, and those
        have a special test of their own, the Lucas–Lehmer test. It’s much faster than any test for numbers in general.
      </p>

      <h2 id="more">More about primes</h2>
      <ul>
        <li>
          <Link href="/is-prime">Is your number prime? Check it →</Link>
        </li>
        <li>
          <Link href="/what-is-a-prime-number">What is a prime number? →</Link>
        </li>
        <li>
          <Link href="/mersenne-primes">What is a Mersenne prime? →</Link>
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
