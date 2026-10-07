import Link from "next/link";
import { pageMetadata } from "@/lib/pageMetadata";
import { AUTHOR_NAME, AUTHOR_URL, SITE_URL } from "@/lib/site";
import { Article } from "../components/Article";
import { CodeBlock } from "../components/CodeBlock";
import { JsonLd } from "../components/JsonLd";
import { UlamSpiral } from "../components/UlamSpiral";

const PAGE_PATH = "/how-it-works";
const PAGE_TITLE = "How It Works: Sieves, Prime Counting and Big Numbers | Every Prime Number";
const PAGE_HEADLINE = "How Every Prime Number works";
const PAGE_DESCRIPTION =
  "How Every Prime Number finds primes live in your browser: the segmented sieve of Eratosthenes, a constant-memory infinite scroll, estimating π(x) with li(x), and fun facts about primes.";

export const metadata = pageMetadata({
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  path: PAGE_PATH,
});

const TECH_ARTICLE_DATA = {
  "@context": "https://schema.org",
  "@type": "TechArticle",
  headline: PAGE_HEADLINE,
  description: PAGE_DESCRIPTION,
  url: `${SITE_URL}${PAGE_PATH}`,
  author: { "@type": "Person", name: AUTHOR_NAME, url: AUTHOR_URL },
};

const SECTIONS = [
  { id: "what-is-a-prime-number", title: "What is a prime number?" },
  { id: "why-check-up-to-square-root", title: "Why you only need to check divisors up to √n" },
  { id: "sieve-of-eratosthenes", title: "How the sieve of Eratosthenes works" },
  { id: "segmented-sieve", title: "How the segmented sieve of Eratosthenes works" },
  { id: "constant-memory-infinite-scroll", title: "How an infinite scroll can use constant memory" },
  { id: "how-many-primes-below-x", title: "How many primes are there below x?" },
  { id: "ramanujan-series", title: "Computing li(x) with Ramanujan’s series" },
  { id: "estimated-positions", title: "How the site estimates a prime’s position after a jump" },
  { id: "javascript-number-limit", title: "What is the largest number JavaScript can store exactly?" },
  { id: "measuring-speed", title: "Why measuring speed in a browser is harder than it looks" },
  { id: "fun-facts", title: "Fun facts about prime numbers" },
] as const;

function SectionHeading({ id }: { id: (typeof SECTIONS)[number]["id"] }) {
  const section = SECTIONS.find((candidate) => candidate.id === id)!;
  return <h2 id={section.id}>{section.title}</h2>;
}

export default function HowItWorksPage() {
  return (
    <Article
      title={PAGE_HEADLINE}
      lead="The math and engineering behind an infinite list of primes that your own computer calculates as you scroll."
    >
      <JsonLd data={TECH_ARTICLE_DATA} />
      <nav aria-label="On this page" className="my-8 rounded-md border border-rule p-4 text-sm">
        <p className="mb-2! font-semibold">On this page</p>
        <ol>
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      {/* 1 */}
      <SectionHeading id="what-is-a-prime-number" />
      <p>
        A prime is a whole number greater than 1 that can only be divided evenly by 1 and itself.
        2, 3, 5, 7, 11 and 13 are prime. 12 is not, because 12 = 3 × 4. Every whole number above 1
        is either prime or a product of primes, which is why primes are often called the atoms of
        arithmetic.
      </p>

      {/* 2 */}
      <SectionHeading id="why-check-up-to-square-root" />
      <p>
        The obvious way to test whether <code>n</code> is prime is to try dividing it by every
        number below it. You can stop much sooner. If <code>n</code> isn’t prime, it splits into
        two factors, and they can’t both be bigger than √n:
      </p>
      <math display="block">
        <mi>n</mi>
        <mo>=</mo>
        <mi>a</mi>
        <mo>×</mo>
        <mi>b</mi>
        <mtext>&nbsp;with&nbsp;</mtext>
        <mi>a</mi>
        <mo>≤</mo>
        <mi>b</mi>
        <mspace width="1em" />
        <mo>⟹</mo>
        <mspace width="1em" />
        <msup>
          <mi>a</mi>
          <mn>2</mn>
        </msup>
        <mo>≤</mo>
        <mi>a</mi>
        <mi>b</mi>
        <mo>=</mo>
        <mi>n</mi>
        <mspace width="1em" />
        <mo>⟹</mo>
        <mspace width="1em" />
        <mi>a</mi>
        <mo>≤</mo>
        <msqrt>
          <mi>n</mi>
        </msqrt>
      </math>
      <p>
        So if nothing up to √n divides <code>n</code>, nothing above it will either: its partner
        factor would have been found already. To test 1,000,003 you only need to try divisors up
        to 1,000. You can go further and try only <em>prime</em> divisors, since any composite
        divisor would have been caught by one of its prime factors first.
      </p>

      {/* 3 */}
      <SectionHeading id="sieve-of-eratosthenes" />
      <p>
        Testing numbers one at a time repeats a lot of work. The sieve of Eratosthenes, over two
        thousand years old, finds all the primes up to a limit at once, and it never divides
        anything:
      </p>
      <ol>
        <li>Write down every number from 2 up to the limit.</li>
        <li>Take the first number not yet crossed off. It’s prime.</li>
        <li>
          Cross off all its multiples, starting from its square. Smaller multiples were already
          crossed off by smaller primes.
        </li>
        <li>Repeat until the next prime squared is past the limit. Everything left is prime.</li>
      </ol>
      <p>
        The catch is memory: you need one slot for every number up to the limit. Sieving to a
        trillion that way would take a trillion slots.
      </p>

      {/* 4 */}
      <SectionHeading id="segmented-sieve" />
      <p>
        The segmented sieve fixes that by sieving one fixed-size window, a segment, at a time.
        To find the primes in a range <code>[low, high)</code>:
      </p>
      <ol>
        <li>
          Find the <strong>base primes</strong>: every prime up to √high. By the √n rule, these
          are the only divisors that matter for anything in the range. They are few: the primes
          below 1,000,000 are enough for every number up to a trillion.
        </li>
        <li>
          For each base prime, jump straight to its first multiple inside the segment and cross
          off every multiple from there to the end.
        </li>
        <li>Whatever survives is prime.</li>
      </ol>
      <p>A small worked example: the primes from 100 to 119.</p>
      <ul>
        <li>√119 is just under 11, so the base primes are 2, 3, 5 and 7.</li>
        <li>2 crosses off 100, 102, 104, …, 118.</li>
        <li>3 starts at 102 (the first multiple of 3 from 100) and crosses off 102, 105, 108, 111, 114, 117.</li>
        <li>5 crosses off 100, 105, 110, 115.</li>
        <li>7 starts at 105 and crosses off 105, 112, 119.</li>
        <li>
          The survivors are <strong>101, 103, 107, 109 and 113</strong>, the five primes in
          that range.
        </li>
      </ul>
      <p>In code, one segment looks roughly like this:</p>
      <CodeBlock
        language="javascript"
        code={`// The primes in [low, high), given every prime up to √high.
function sieveSegment(low, high, basePrimes, isComposite) {
  isComposite.fill(0, 0, high - low); // reuse one buffer for every segment
  for (const prime of basePrimes) {
    if (prime * prime >= high) break;
    // First multiple of prime inside the segment, but never below prime².
    const firstMultiple = Math.max(prime * prime, Math.ceil(low / prime) * prime);
    for (let multiple = firstMultiple; multiple < high; multiple += prime) {
      isComposite[multiple - low] = 1;
    }
  }
  const primes = [];
  for (let candidate = Math.max(low, 2); candidate < high; candidate++) {
    if (!isComposite[candidate - low]) primes.push(candidate);
  }
  return primes;
}`}
      />
      <p>
        This is how the site’s background worker finds primes, in C compiled to WebAssembly.
        Memory stays flat because the scratch buffer is the same size for every segment,
        wherever it is on the number line (it even skips even numbers, which halves it). Only
        the list of base primes grows, with the square root of the numbers: the primes below
        about 95 million cover everything up to 2⁵³. The worker keeps that list and extends it
        only when the numbers get big enough to need more.
      </p>
      <p>
        A batch on the site is always 500 primes, not a fixed range of numbers. Primes thin out
        as numbers grow, so each batch covers a wider stretch of numbers, and every segment has
        more base primes to cross off with. On a recent laptop a batch near a million takes
        about 0.03 ms; near a trillion, 0.2 ms; just below 2⁵³, about 5 ms. That’s the slowdown
        the counter shows.
      </p>

      {/* 5 */}
      <SectionHeading id="constant-memory-infinite-scroll" />
      <p>
        You can scroll forever, but the page never holds more than 1,500 primes. They live in a
        <strong> rolling buffer</strong> of three batches of 500:
      </p>
      <ul>
        <li>
          Scroll down until the bottom of the screen is 60% of the way through the last batch,
          and the worker is asked for the next 500 primes. When they arrive, they’re added at the
          end and the first batch is dropped.
        </li>
        <li>
          Scroll up until the top of the screen is 60% of the way back through the first batch,
          and the 500 primes before it are requested. They’re added at the start and the last
          batch is dropped. At 2 it stops: there’s nothing before it.
        </li>
        <li>
          When a batch is dropped from the top or added above you, every row below it moves. The
          list moves its scroll position by exactly the same amount, so the primes on screen
          don’t jump.
        </li>
      </ul>
      <p>
        Scrolling back up recomputes primes the page has already seen, on purpose. Storing them
        all would make memory grow forever. Recomputing keeps memory flat and only costs CPU,
        which is the whole point of the site anyway. Only the rows near the screen are actually
        drawn, so the number of elements on the page stays small too.
      </p>
      <p>
        The worker only computes when the buffer asks for more, so it never races ahead into
        numbers nobody has scrolled to. When it is working, it runs flat out in a background
        thread, so the page stays responsive.
      </p>

      {/* 6 */}
      <SectionHeading id="how-many-primes-below-x" />
      <p>
        Mathematicians write <strong>π(x)</strong> (nothing to do with 3.14159…) for the number
        of primes up to <code>x</code>. π(10) = 4, because of 2, 3, 5 and 7. There’s no neat
        formula for π(x), but there is a famously good approximation, the{" "}
        <strong>logarithmic integral</strong>:
      </p>
      <math display="block">
        <mrow>
          <mi>π</mi>
          <mo>(</mo>
          <mi>x</mi>
          <mo>)</mo>
        </mrow>
        <mo>≈</mo>
        <mrow>
          <mi>li</mi>
          <mo>(</mo>
          <mi>x</mi>
          <mo>)</mo>
        </mrow>
        <mo>=</mo>
        <msubsup>
          <mo>∫</mo>
          <mn>0</mn>
          <mi>x</mi>
        </msubsup>
        <mfrac>
          <mrow>
            <mi>d</mi>
            <mi>t</mi>
          </mrow>
          <mrow>
            <mi>ln</mi>
            <mspace width="0.17em" />
            <mi>t</mi>
          </mrow>
        </mfrac>
      </math>
      <p>
        The idea behind it: near a number <code>t</code>, roughly one number in every{" "}
        <code>ln t</code> is prime. Add up those chances from 0 to <code>x</code> and you get
        the expected count. It’s remarkably close. At a trillion:
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Up to 10¹²</th>
            <th scope="col">Value</th>
            <th scope="col">Off by</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>π(10¹²), the real count</td>
            <td>37,607,912,018</td>
            <td>—</td>
          </tr>
          <tr>
            <td>li(10¹²)</td>
            <td>37,607,950,280.8</td>
            <td>38,263 (0.0001%)</td>
          </tr>
          <tr>
            <td>10¹² / ln 10¹²</td>
            <td>36,191,206,825</td>
            <td>1,416,705,193 (3.8%)</td>
          </tr>
        </tbody>
      </table>
      <p>
        The simpler <code>x / ln x</code> is what you often see quoted, but it’s about 37,000
        times further off here.
      </p>
      <p>
        <Link href="/?jump=1000000000000">See it live: jump to a trillion →</Link>
      </p>

      {/* 7 */}
      <SectionHeading id="ramanujan-series" />
      <p>
        The integral above can’t be computed directly with a calculator button. The site uses a
        series found by Srinivasa Ramanujan, which converges quickly for any <code>x</code>:
      </p>
      <math display="block">
        <mrow>
          <mi>li</mi>
          <mo>(</mo>
          <mi>x</mi>
          <mo>)</mo>
        </mrow>
        <mo>=</mo>
        <mi>γ</mi>
        <mo>+</mo>
        <mi>ln</mi>
            <mspace width="0.17em" />
        <mi>ln</mi>
            <mspace width="0.17em" />
        <mi>x</mi>
        <mo>+</mo>
        <msqrt>
          <mi>x</mi>
        </msqrt>
        <munderover>
          <mo>∑</mo>
          <mrow>
            <mi>n</mi>
            <mo>=</mo>
            <mn>1</mn>
          </mrow>
          <mi>∞</mi>
        </munderover>
        <mfrac>
          <mrow>
            <msup>
              <mrow>
                <mo>(</mo>
                <mo>−</mo>
                <mn>1</mn>
                <mo>)</mo>
              </mrow>
              <mrow>
                <mi>n</mi>
                <mo>−</mo>
                <mn>1</mn>
              </mrow>
            </msup>
            <msup>
              <mrow>
                <mo>(</mo>
                <mi>ln</mi>
            <mspace width="0.17em" />
                <mi>x</mi>
                <mo>)</mo>
              </mrow>
              <mi>n</mi>
            </msup>
          </mrow>
          <mrow>
            <mi>n</mi>
            <mo>!</mo>
            <mo>·</mo>
            <msup>
              <mn>2</mn>
              <mrow>
                <mi>n</mi>
                <mo>−</mo>
                <mn>1</mn>
              </mrow>
            </msup>
          </mrow>
        </mfrac>
        <munderover>
          <mo>∑</mo>
          <mrow>
            <mi>k</mi>
            <mo>=</mo>
            <mn>0</mn>
          </mrow>
          <mrow>
            <mo>⌊</mo>
            <mo>(</mo>
            <mi>n</mi>
            <mo>−</mo>
            <mn>1</mn>
            <mo>)</mo>
            <mo>/</mo>
            <mn>2</mn>
            <mo>⌋</mo>
          </mrow>
        </munderover>
        <mfrac>
          <mn>1</mn>
          <mrow>
            <mn>2</mn>
            <mi>k</mi>
            <mo>+</mo>
            <mn>1</mn>
          </mrow>
        </mfrac>
      </math>
      <p>
        Here γ ≈ 0.5772 is the Euler–Mascheroni constant. It looks fearsome, but it’s a loop.
        Each term reuses the previous one, so there are no giant powers or factorials:
      </p>
      <CodeBlock
        language="javascript"
        code={`const lnX = Math.log(x);
let sum = 0;
let powerOverFactorial = 1; // (ln x)^n / (n! · 2^(n−1))
let oddReciprocalSum = 0;   // 1 + 1/3 + 1/5 + …

for (let n = 1; n <= 200; n++) {
  powerOverFactorial *= n === 1 ? lnX : lnX / (2 * n);
  if (n % 2 === 1) oddReciprocalSum += 1 / n;
  const term = (n % 2 === 1 ? 1 : -1) * powerOverFactorial * oddReciprocalSum;
  sum += term;
  if (n > lnX && Math.abs(term) < Number.EPSILON * Math.abs(sum)) break;
}
return EULER_MASCHERONI + Math.log(lnX) + Math.sqrt(x) * sum;`}
      />
      <p>
        The site’s tests check it against known values: li(10⁶) ≈ 78,627.5, li(10⁹) ≈
        50,849,234.9 and li(10¹²) ≈ 37,607,950,280.8, all to within 0.1.
      </p>

      {/* 8 */}
      <SectionHeading id="estimated-positions" />
      <p>
        Next to each prime the list shows its position: 2 is #1, 3 is #2, and so on. Scrolling
        from the start, that’s just counting. But when you jump to, say, a trillion, the site
        has no idea how many primes it skipped. Counting them exactly would mean finding all
        37.6 billion of them.
      </p>
      <p>
        So it estimates, once. The first prime the jump finds (the anchor) gets{" "}
        <code>li(anchor)</code>, rounded. Every other row counts exactly up or down from the
        anchor, so neighbouring labels always differ by exactly 1. The estimate is shown with
        a “≈”, and a banner above the list says so. Jumping to a trillion lands on
        1,000,000,000,039, labelled ≈ #37,607,950,282. That’s about 38,000 too high: roughly
        0.0001% off.
      </p>
      <p>
        Scroll all the way back down to 2 and the buffer finally knows exactly where it is: the
        “≈” and the banner disappear and every label becomes exact.
      </p>
      <p>
        <Link href="/?jump=1000000000">Try it: jump to a billion and look for the “≈” →</Link>
      </p>

      {/* 9 */}
      <SectionHeading id="javascript-number-limit" />
      <p>
        JavaScript numbers are 64-bit floating point. They store whole numbers exactly only up
        to
      </p>
      <math display="block">
        <msup>
          <mn>2</mn>
          <mn>53</mn>
        </msup>
        <mo>−</mo>
        <mn>1</mn>
        <mo>=</mo>
        <mn>9,007,199,254,740,991</mn>
      </math>
      <p>
        That’s <code>Number.MAX_SAFE_INTEGER</code>. Past it, numbers start rounding:{" "}
        <code>2**53 + 1</code> comes out as 9,007,199,254,740,992. A prime finder that silently
        rounds would show wrong primes, which is worse than showing none. So the site never
        uses ordinary numbers for the primes the worker finds: from the C sieve to the page,
        each one is a 64-bit integer, a JavaScript <code>BigInt</code>, which stays exact far
        past 2⁵³.
      </p>
      <p>
        The limit today is the sieve’s own. It stops at 2⁵³ − 1, because that’s where its base
        primes stop growing. The jump box won’t accept anything from there up, and if scrolling
        ever reaches it, the page announces that you broke math.
      </p>

      {/* 10 */}
      <SectionHeading id="measuring-speed" />
      <p>
        The primes-per-second counter is the joke of the site: it starts huge and sinks as the
        numbers grow. Measuring it honestly turned out to be tricky.
      </p>
      <p>
        Browsers deliberately round <code>performance.now()</code>, because precise timers can
        be used for fingerprinting and for timing attacks like Spectre. Without special setup,
        the steps are often 0.1 ms or coarser. Early batches of small primes finish faster than
        that, so a single batch usually measures 0 ms, or one whole step. Dividing 500 primes by
        a duration that’s mostly rounding error gives a counter that leaps around by 10×.
      </p>
      <p>Two fixes:</p>
      <ul>
        <li>
          <strong>Average over a window.</strong> The counter divides the total primes from
          recent batches by their total measured time, keeping enough batches to cover at least
          50 ms (and at most 32 batches, so it still reacts when things slow down). Batches that
          measured 0 ms still count. Across many batches the rounding evens out.
        </li>
        <li>
          <strong>Cross-origin isolation.</strong> The site sends the{" "}
          <code>Cross-Origin-Opener-Policy</code> and <code>Cross-Origin-Embedder-Policy</code>{" "}
          headers. In exchange for only loading resources it’s allowed to, the page gets a much
          finer timer. In Chrome it went from 0.1 ms steps to 0.005 ms.
        </li>
      </ul>
      <p>
        The counter measures sieving time, not wall-clock time: when you stop scrolling, the
        worker rests and the counter keeps its last value instead of sinking to zero. Building
        base primes, which can take a noticeable moment after a big jump, is timed separately
        and left out, so the counter shows steady sieving speed.
      </p>

      {/* 11 */}
      <SectionHeading id="fun-facts" />

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

      <h3 id="rsa-encryption">Where are prime numbers used? RSA encryption</h3>
      <p>
        Every time you load a page over HTTPS, primes may be doing the work. RSA encryption
        builds a public key by multiplying two enormous secret primes. Multiplying them is
        instant, but splitting the product back into its two primes is so slow for numbers that
        size that, as far as anyone knows, no computer can do it in a useful amount of time.
      </p>

      <p className="mt-12 border-t border-rule pt-6 text-muted">
        Want to see it in action? <Link href="/">Start scrolling</Link>, or read{" "}
        <Link href="/about">about the site</Link>.
      </p>
    </Article>
  );
}
