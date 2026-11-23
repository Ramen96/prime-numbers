import Link from "next/link";
import { pageMetadata } from "@/lib/pageMetadata";
import { Article } from "../components/Article";
import { UlamSpiral } from "../components/UlamSpiral";

// Fun facts about primes, each one checkable on the site. Moved here from the
// end of /how-it-works (2026-11-22), which links to this page; the moved facts
// keep their anchors.

export const metadata = pageMetadata({
  title: "Fun facts about prime numbers | Every Prime Number",
  description:
    "Why 1 isn’t prime, why there are endless primes but also endless prime-free stretches, the numbers that fool primality tests, and the primes that cicadas use.",
  path: "/fun-facts",
});

export default function FunFactsPage() {
  return (
    <Article
      title="Fun facts about prime numbers"
      lead="Some are famous, some are odd, and every number here can be checked on this site."
    >
      <h2 id="the-basics">The basics</h2>
      <p>
        <Link href="/what-is-a-prime-number">New to primes? Start with What is a prime number? →</Link>
      </p>

      <h3 id="only-even-prime">Why is 2 the only even prime?</h3>
      <p>
        Every other even number has 2 as a factor, so it has at least three divisors: 1, 2 and
        itself. 2 is the one even number whose only divisors are 1 and itself.{" "}
        <Link href="/is-prime/2">Is 2 prime? →</Link>
      </p>

      <h3 id="why-1-isnt-prime">Why isn’t 1 a prime number?</h3>
      <p>
        A prime has exactly two divisors, and 1 has one. There’s a better reason, too: every
        whole number above 1 has exactly one way to be written as a product of primes (6 is 2 ×
        3, and nothing else). If 1 counted, 6 would also be 1 × 2 × 3, and 1 × 1 × 2 × 3,
        forever. Not everyone always agreed: D. N. Lehmer’s 1914 table of primes starts at 1.{" "}
        <Link href="/is-prime/1">Is 1 prime? →</Link>
      </p>

      <h3 id="six-k-plus-or-minus-one">Every prime after 3 is next to a multiple of 6</h3>
      <p>
        Every whole number is 6k, 6k ± 1, 6k ± 2 or 6k + 3. The ±2 numbers and 6k are even, and
        6k + 3 is a multiple of 3, so after 2 and 3 a prime can only be 6k − 1 or 6k + 1. It
        doesn’t work the other way round: 25 is 6 × 4 + 1, and 5 × 5.{" "}
        <Link href="/is-prime/25">Is 25 prime? →</Link>
      </p>

      <h3 id="primes-below-100">How many primes are there below 100?</h3>
      <p>
        25. Then 168 below a thousand, 78,498 below a million and 50,847,534 below a billion:
        plenty, but a shrinking share.{" "}
        <Link href="/how-it-works#how-many-primes-below-x">How to count them without listing them →</Link>
      </p>

      <h3 id="infinitely-many-primes">Why are there infinitely many primes?</h3>
      <p>
        Euclid proved it around 300 BC, and the proof still fits on a napkin. Suppose there
        were only finitely many primes, <em>p₁, p₂, …, pₖ</em>. Multiply them all together and
        add 1:
      </p>
      <math display="block">
        <mi>N</mi>
        <mo>=</mo>
        <msub>
          <mi>p</mi>
          <mn>1</mn>
        </msub>
        <msub>
          <mi>p</mi>
          <mn>2</mn>
        </msub>
        <mo>⋯</mo>
        <msub>
          <mi>p</mi>
          <mi>k</mi>
        </msub>
        <mo>+</mo>
        <mn>1</mn>
      </math>
      <ol>
        <li>Dividing N by any of the primes on the list leaves a remainder of 1.</li>
        <li>So no prime on the list divides N.</li>
        <li>
          But N is bigger than 1, so it has at least one prime factor (maybe N itself).
        </li>
        <li>That prime isn’t on the list, so the list wasn’t complete after all.</li>
      </ol>
      <p>
        Any finite list of primes is missing one, so there are infinitely many. Which is why a
        site called Every Prime Number is a joke with no punchline: you can scroll forever and
        never finish.
      </p>

      <h2 id="how-primes-are-spread-out">How primes are spread out</h2>

      <h3 id="prime-number-theorem">The prime number theorem in plain English</h3>
      <p>
        Primes get rarer as numbers grow, but in a very predictable way. Around a number{" "}
        <em>x</em>, about one number in every ln <em>x</em> is prime: about one in 7 near a
        thousand, one in 14 near a million, one in 28 near a trillion. That’s the prime number
        theorem, proved in 1896 by Jacques Hadamard and Charles de la Vallée Poussin
        independently, and it’s the reason the counter on the home page slows down: the further
        you go, the more numbers the worker has to throw away for each prime it finds.
      </p>

      <h3 id="twin-primes">Prime gaps and twin primes</h3>
      <p>
        The gap between one prime and the next tends to grow, roughly like ln <em>x</em> on
        average, but it keeps dropping back to 2. Pairs of primes that differ by 2, like 11 and
        13 or 1,000,000,000,061 and 1,000,000,000,063, are <strong>twin primes</strong>. The{" "}
        <strong>twin prime conjecture</strong> says there are infinitely many of them. Nobody
        has proved it. The closest result: in 2013 Yitang Zhang proved that some gap of at most
        70 million occurs infinitely often, and collaborative work soon brought that bound down
        to 246.
      </p>
      <p>
        <Link href="/?jump=1000000000061">See that twin prime pair just past a trillion →</Link>
      </p>

      <h3 id="prime-free-stretches">There are prime-free stretches as long as you like</h3>
      <p>
        Take 101! (101 × 100 × … × 2). Then 101! + 2 is divisible by 2, 101! + 3 by 3, and so on
        up to 101! + 101, divisible by 101: a hundred composite numbers in a row. Any length
        works. The longest gap anyone has found below 2⁶⁴ is 1,550 numbers wide, straight after
        the prime 18,361,375,334,787,046,697, and the list on this site can take you there.
      </p>
      <p>
        <Link href="/?jump=18361375334787046697">See the gap of 1,550 →</Link>
      </p>

      <h3 id="bertrands-postulate">There’s always a prime between n and 2n</h3>
      <p>
        For every whole number n above 1, at least one prime lies between n and 2n. Joseph
        Bertrand conjectured it in 1845; Pafnuty Chebyshev proved it in 1852.
      </p>

      <h3 id="goldbach-conjecture">Goldbach’s conjecture</h3>
      <p>
        Every even number greater than 2 seems to be the sum of two primes: 4 = 2 + 2, 28 = 5 +
        23, 100 = 3 + 97. Christian Goldbach suggested it in a letter to Euler in 1742. It has
        been checked by computer for every even number up to 4 × 10¹⁸, and it is still unproved.
      </p>

      <h3 id="riemann-hypothesis">The Riemann hypothesis and how far li(x) can be off</h3>
      <p>
        The site leans on li(x) being close to π(x). How close is it guaranteed to be? That
        depends on the most famous unsolved problem in mathematics. If the Riemann hypothesis is
        true, then for every x ≥ 2,657:
      </p>
      <math display="block">
        <mo>|</mo>
        <mi>π</mi>
        <mo>(</mo>
        <mi>x</mi>
        <mo>)</mo>
        <mo>−</mo>
        <mi>li</mi>
        <mo>(</mo>
        <mi>x</mi>
        <mo>)</mo>
        <mo>|</mo>
        <mo>&lt;</mo>
        <mfrac>
          <mrow>
            <msqrt>
              <mi>x</mi>
            </msqrt>
            <mi>ln</mi>
            <mspace width="0.17em" />
            <mi>x</mi>
          </mrow>
          <mrow>
            <mn>8</mn>
            <mi>π</mi>
          </mrow>
        </mfrac>
      </math>
      <p>
        That bound is Lowell Schoenfeld’s (1976). At a trillion it allows an error of about 1.1
        million; the real error is 38,263. Without the Riemann hypothesis, the proven bounds are
        much weaker. One more twist: li(x) is bigger than π(x) for every x anyone has checked,
        but J. E. Littlewood proved in 1914 that the two swap places infinitely often. The
        first swap is somewhere far beyond anything a computer could reach by counting.
      </p>

      <h2 id="numbers-that-fool-primality-tests">Numbers that fool primality tests</h2>

      <h3 id="carmichael-numbers">561, the number that passes Fermat’s test</h3>
      <p>
        Fermat’s little theorem gives a quick test: if n is prime, aⁿ⁻¹ leaves remainder 1 when
        divided by n. 561 = 3 × 11 × 17 passes it for every base a that shares no factor with
        it. Numbers like that are Carmichael numbers, and in 1994 Alford, Granville and
        Pomerance proved there are infinitely many.{" "}
        <Link href="/is-prime/561">Is 561 prime? →</Link>
      </p>
      <p>
        How the tests work, step by step:{" "}
        <Link href="/how-to-tell-if-a-number-is-prime">How to tell if a number is prime →</Link>
      </p>

      <h3 id="fools-13-tests">The number that fools 13 tests at once</h3>
      <p>
        Miller–Rabin is a stronger test, and with the first 13 primes as bases no composite
        passes it until 3,317,044,064,679,887,385,961,981. That number passes all 13, which is
        exactly where this site stops trusting the test and starts building proofs.{" "}
        <Link href="/is-prime/3317044064679887385961981">Is it prime? →</Link>
      </p>

      <h3 id="proof-without-a-word">A proof without a word</h3>
      <p>
        In 1903 Frank Nelson Cole gave a talk in which he didn’t speak. He worked out 2⁶⁷ − 1 on
        one side of a blackboard, 193,707,721 × 761,838,257,287 on the other, and they matched.
        Mersenne had listed 2⁶⁷ − 1 as prime.{" "}
        <Link href="/is-prime/147573952589676412927">Is 2⁶⁷ − 1 prime? →</Link>
      </p>

      <h2 id="record-primes">Record primes, and primes at work</h2>

      <h3 id="mersenne-primes">Mersenne primes and the largest known prime</h3>
      <p>
        A Mersenne number is one less than a power of two, <em>2ᵖ − 1</em>. For it to be prime,
        p has to be prime, but that isn’t enough: 2¹¹ − 1 = 2047 = 23 × 89. Mersenne numbers
        have a very fast special-purpose primality test (the Lucas–Lehmer test), so the largest
        known primes are almost always Mersenne primes.
      </p>
      {/*
        TODO(owner): verify the current record before adding specifics. Claim to check:
          - the largest known prime (as 2^p − 1, i.e. the exponent p),
          - its number of decimal digits,
          - its discovery date,
          - source: GIMPS, https://www.mersenne.org/
        Then replace the general sentence below with the verified figures.
      */}
      <p>
        The record holders are found by the Great Internet Mersenne Prime Search (GIMPS), a
        volunteer project running since 1996 on thousands of ordinary computers. The current
        record is listed at{" "}
        <a href="https://www.mersenne.org/" rel="noopener noreferrer">
          mersenne.org
        </a>
        . It would take this site a little longer to scroll there.
      </p>
      <p>
        More about them: <Link href="/mersenne-primes">What is a Mersenne prime? →</Link>
      </p>

      <h3 id="rsa-encryption">Where are prime numbers used? RSA encryption</h3>
      <p>
        Every time you load a page over HTTPS, primes may be doing the work. RSA encryption
        builds a public key by multiplying two enormous secret primes. Multiplying them is
        instant, but splitting the product back into its two primes is so slow for numbers that
        size that, as far as anyone knows, no computer can do it in a useful amount of time.
      </p>

      <h3 id="cicadas">Cicadas that count in primes</h3>
      <p>
        Some cicadas in North America spend 13 or 17 years underground, then emerge all at
        once. One idea is that a prime cycle rarely lines up with a predator’s shorter cycle: a
        17-year brood meets a 2- or 3-year predator boom only once in 34 or 51 years.
      </p>

      <h2 id="patterns">Patterns</h2>

      <h3 id="ulam-spiral">What is the Ulam spiral?</h3>
      <p>
        In 1963, the mathematician Stanisław Ulam was doodling during a dull talk. He wrote the
        numbers in a square spiral, starting from 1 in the middle, and circled the primes. They
        didn’t scatter randomly. They clumped along diagonal lines:
      </p>
      <UlamSpiral />
      <p>
        Each diagonal in the spiral is the set of values of a quadratic like 4n² + 2n + 1. Some
        quadratics can never be prime (for instance, if they’re always even), and others turn
        out to hit primes unusually often. Euler’s n² + n + 41 is prime for every n from 0 to 39.
        The lines are those prime-rich quadratics showing through.
      </p>

      <h2 id="on-this-site">On this site</h2>

      <h3 id="certificates">A prime can carry its own proof</h3>
      <p>
        An elliptic curve certificate is a chain of facts that proves a number prime, and
        checking it is far faster than finding it.{" "}
        <Link href="/random-prime">Get a random prime with its certificate, and check it yourself →</Link>
      </p>

      <h3 id="hidden-in-the-list">Hidden in the list</h3>
      <p>
        Scroll to 314,159, or to 359. And when proofs get slow, the list sometimes has something
        to say. <Link href="/?jump=314159">Go to 314,159 →</Link>
      </p>

      <p className="mt-12 border-t border-rule pt-6 text-muted">
        Got a number of your own? <Link href="/is-prime">Check whether it’s prime</Link>, or{" "}
        <Link href="/">start scrolling</Link>.
      </p>
    </Article>
  );
}
