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
  "How Every Prime Number finds primes live in your browser: the segmented sieve of Eratosthenes on several threads, a constant-memory infinite scroll, estimating π(x) with li(x), numbers bigger than 64 bits as 32-bit limbs, proving huge primes with elliptic curve certificates, and fun facts about primes.";

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
  { id: "numbers-bigger-than-64-bits", title: "How to work with numbers bigger than 64 bits: 32-bit limbs" },
  { id: "proving-huge-primes", title: "How to prove a huge number is prime: elliptic curve certificates" },
  { id: "displaying-long-primes", title: "How the list shows primes too long for the screen" },
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
        the list of base primes grows, with the square root of the numbers: covering everything
        up to 2⁶⁴ takes every prime below 2³², about 203 million of them. To fit, they’re stored
        as the gaps between them, halved (every gap after 2 is even), one byte each. The worker
        keeps that list and extends it only when the numbers get big enough to need more, up
        to a point it measures on your device (see below).
      </p>
      <p>
        A batch on the site is always 500 primes, not a fixed range of numbers. Primes thin out
        as numbers grow, so each batch covers a wider stretch of numbers, and every segment has
        more base primes to cross off with. On a recent laptop, sieving on 9 threads, a batch
        near a million takes about 0.1 ms; near a trillion, 0.3 ms; near 2⁵³, about 1.5 ms; near
        2⁶³, about 2 ms; past 2⁶⁴, about 6 ms. That’s the slowdown the counter shows.
      </p>
      <p>
        On a device with several cores, the sieve runs on several threads at once: one fewer
        than the cores, so the page keeps one for scrolling. A batch of 500 primes almost always
        fits in a single segment, so the threads don’t each take a segment of their own. They
        share one, each crossing off with its own slice of the base primes, and their marks are
        combined at the end. Splitting only pays once a segment needs a lot of base primes, so
        the worker measures where that starts on your device. Building the base primes is split
        the other way: each thread sieves a whole segment of its own. Threads need shared
        memory, which browsers allow only on cross-origin isolated pages; where they can’t
        start, the worker sieves on one thread instead. The primes are the same either way,
        just slower, and the “threads” line under the counter shows which you have. The
        Miller–Rabin tests described below are shared between the threads too.
      </p>
      <p>
        Before a batch is shown, every prime in it is checked again by a completely separate
        method: a Miller–Rabin test, written in TypeScript and sharing no code with the C sieve.
        With the first 13 primes as its test bases, it’s proven never to call a composite prime
        below about 3.3 × 10²⁴; past that, each prime’s{" "}
        <a href="#proving-huge-primes">certificate</a> is checked instead. If the two ever disagreed, the
        site would stop with an error rather than show the disputed number. Once it sieves
        partially, the C side runs its own Miller–Rabin test too (see below), and every number it
        throws out comes with evidence: a small factor, or a “witness” base. The TypeScript side
        checks that evidence again, with one division or one modular exponentiation, so a prime
        thrown out by mistake would stop the list with an error instead of quietly going
        missing. The check takes about 1 ms per batch near a million. For big primes it’s split
        between several background workers, about 3 ms near 2⁶³ on a laptop. It appears separately under “checked” and doesn’t count toward the speed.
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
        which is the whole point of the site anyway. The one exception is past 3.3 × 10²⁴, where
        each prime needs a <a href="#proving-huge-primes">proof</a> that can take minutes: there
        the worker keeps the primes it has proven, up to about 16 MB of them, oldest dropped
        first, so scrolling back doesn’t prove them all again. Only the rows near the screen are
        actually drawn, so the number of elements on the page stays small too.
      </p>
      <p>
        The worker only computes when the buffer asks for more, so it never races ahead into
        numbers nobody has scrolled to. When it is working, it runs flat out in background
        threads, leaving one core free, so the page stays responsive.
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
        series found by Srinivasa Ramanujan, which converges quickly for every <code>x</code>{" "}
        it needs:
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

for (let n = 1; n <= 2000; n++) {
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
      <p>
        Past 10³⁰⁰, li(x) is too big for a JavaScript number, so the site switches to the
        asymptotic expansion{" "}
        <math>
          <mrow>
            <mi>li</mi>
            <mo>(</mo>
            <mi>x</mi>
            <mo>)</mo>
          </mrow>
          <mo>≈</mo>
          <mfrac>
            <mi>x</mi>
            <mrow>
              <mi>ln</mi>
              <mspace width="0.17em" />
              <mi>x</mi>
            </mrow>
          </mfrac>
          <munderover>
            <mo>∑</mo>
            <mrow>
              <mi>k</mi>
              <mo>=</mo>
              <mn>0</mn>
            </mrow>
            <mi>K</mi>
          </munderover>
          <mfrac>
            <mrow>
              <mi>k</mi>
              <mo>!</mo>
            </mrow>
            <msup>
              <mrow>
                <mo>(</mo>
                <mi>ln</mi>
                <mspace width="0.17em" />
                <mi>x</mi>
                <mo>)</mo>
              </mrow>
              <mi>k</mi>
            </msup>
          </mfrac>
        </math>
        , with <em>K</em> where its terms are smallest, and does the final multiplication by{" "}
        <em>x</em> in <code>BigInt</code>.
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
        each one is a JavaScript <code>BigInt</code>, exact at any size the browser can hold
        (in Chrome, about 323 million digits).
      </p>
      <p>
        Past 2⁶⁴, even C’s largest built-in integers run out, so the sieve builds its own big
        numbers out of 32-bit pieces. That gets{" "}
        <a href="#numbers-bigger-than-64-bits">its own section below</a>.
      </p>
      <p>
        To sieve near <em>x</em> completely, the worker needs every prime up to √<em>x</em>,
        which gets slower and takes more memory as <em>x</em> grows. So past a point, it stops
        doing that. It sieves with only a small set of base primes, which crosses off most
        composites, and proves each number that survives with a Miller–Rabin test: the same
        deterministic test as the check above, written again in C. Proving a prime costs about
        the same however large the sieve was, so this soon wins by a long way: near 2⁶³ on a laptop, about
        2 ms a batch instead of 39 ms, and 4 MB of base primes instead of 150 MB.
      </p>
      <p>
        Where that point is depends on your device, so the worker measures it. The first time
        you go past 2³², it times real batches both ways at 2³⁶, 2⁴⁰, 2⁴⁴ and so on, stopping
        where the partial sieve is clearly faster, then tries a few sizes for the small set of
        base primes and keeps the fastest. Past 2⁶⁴, where the arithmetic changes, it times
        those sizes again. Both ways must find exactly the same primes, or the site stops with
        an error, so every measurement is also a check. That proof only holds below
        3,317,044,064,679,887,385,961,981 (about 3.3 × 10²⁴). Past it, each number the sieve
        can’t cross off needs a real primality proof, which has{" "}
        <a href="#proving-huge-primes">its own section below</a>.
      </p>
      <p>
        How much memory that is comes from your device, not from the code: a quarter of its
        memory where the browser reports it (browsers report at most 8 GB, so at most 2 GB).
        Staying within it is better than the browser closing the tab. Where
        the browser doesn’t say, the worker keeps growing until an allocation fails, at most to
        the 4 GB a WebAssembly module can address, and then puts its base primes back exactly
        as they were. The threaded sieve’s shared memory has to be reserved in full up front,
        so it’s sized from the same budget; some browsers won’t reserve much (iOS Safari refuses
        4 GB), so where one says no, the worker asks for half, then half again. Before a jump,
        it works out the least
        memory the base primes could possibly need; if even that won’t fit, it skips building
        them and sieves partially straight away. A WebAssembly module’s memory never shrinks,
        so if a worker has grown large, jumping somewhere smaller starts a fresh one to give the
        memory back.
      </p>

      {/* 10 */}
      <SectionHeading id="numbers-bigger-than-64-bits" />
      <p>
        Inside the sieve, a window that stays below 2⁶⁴ works with plain 64-bit integers
        (<code>uint64_t</code> in C), the fast path. A window that reaches 2⁶⁴ works with
        numbers made of 32-bit <strong>limbs</strong>: an array of them, least significant
        first, plus a count of how many there are:
      </p>
      <math display="block">
        <mi>x</mi>
        <mo>=</mo>
        <msub>
          <mi>ℓ</mi>
          <mn>0</mn>
        </msub>
        <mo>+</mo>
        <msub>
          <mi>ℓ</mi>
          <mn>1</mn>
        </msub>
        <mo>·</mo>
        <msup>
          <mn>2</mn>
          <mn>32</mn>
        </msup>
        <mo>+</mo>
        <msub>
          <mi>ℓ</mi>
          <mn>2</mn>
        </msub>
        <mo>·</mo>
        <msup>
          <mn>2</mn>
          <mn>64</mn>
        </msup>
        <mo>+</mo>
        <mo>⋯</mo>
      </math>
      <p>
        There’s no fixed maximum: a number gets as many limbs as it needs. The first prime past
        2⁶⁴, 18,446,744,073,709,551,629, is three limbs: 13, 0 and 1, because it equals 13 + 0 ·
        2³² + 1 · 2⁶⁴. The sieve needs only a few operations on these: compare, add or subtract a
        small number (to step from one window to the next), a square root that may round up
        but never down (to know which base primes a window needs), and the one that does the
        real work, <strong>big mod small</strong>. The tests run the big-number code below 2⁶⁴
        too, where it has to find exactly the same primes as the fast path.
      </p>

      <h3 id="big-mod-small">Where a base prime lands: big mod small</h3>
      <p>
        To cross off the multiples of a base prime <em>p</em> in a window starting at{" "}
        <code>low</code>, the sieve needs the first multiple of <em>p</em> at or after{" "}
        <code>low</code>, and that comes from the remainder <code>low mod p</code>. It’s long
        division done one limb at a time, from the most significant down, the way you’d divide
        by hand one digit at a time, except that each digit is 32 bits:
      </p>
      <math display="block">
        <mi>r</mi>
        <mo>←</mo>
        <mrow>
          <mo>(</mo>
          <mi>r</mi>
          <mo>·</mo>
          <msup>
            <mn>2</mn>
            <mn>32</mn>
          </msup>
          <mo>+</mo>
          <msub>
            <mi>ℓ</mi>
            <mi>i</mi>
          </msub>
          <mo>)</mo>
        </mrow>
        <mspace width="0.3em" />
        <mi>mod</mi>
        <mspace width="0.3em" />
        <mi>p</mi>
      </math>
      <CodeBlock
        language="c"
        code={`// low mod p: one 32-bit limb at a time, most significant first
uint64_t remainder = 0;
for (size_t index = limb_count; index-- > 0;)
  remainder = ((remainder << 32) | limbs[index]) % p;`}
      />
      <p>
        The first multiple is then <em>p</em> − <em>r</em> past <code>low</code> (or right at it
        if <em>r</em> is 0). Segments hold only odd numbers, so if that lands on an even
        number, it moves on by one more <em>p</em>.
      </p>

      <h3 id="small-inner-loop">Why the inner loop never touches a big number</h3>
      <p>
        Everything after that is small. A window covers 65,536 numbers, so every position in
        it is an offset below 65,536, and the marking loop is the same one the fast path uses:
        start at the first offset and step by <em>p</em>. The big-number arithmetic happens
        once per base prime per window, never once per multiple. Primes leave the sieve the
        same way: the window’s first prime as limbs, and every other prime as a small offset
        from it. JavaScript rebuilds each one as a <code>BigInt</code>, most significant limb
        first, with <code>(result &lt;&lt; 32n) | limb</code>, so no prime ever passes through an
        ordinary JavaScript number.
      </p>

      <h3 id="64-bit-remainder">Why the remainder uses 64-bit arithmetic in WebAssembly</h3>
      <p>
        The remainder <em>r</em> is always less than <em>p</em>. While <em>p</em> is below 2³²,{" "}
        <em>r</em> · 2³² + a limb is below 2⁶⁴, so each step is one 64-bit division, a single
        WebAssembly instruction. A base prime of 2³² or more would need a 128-bit intermediate,
        and WebAssembly has no 128-bit division at all: the compiler turns it into a call to a
        software routine. Every base prime stays below 2³² until about 2⁶⁴ + 1.3 × 10¹¹ (that’s
        where (2³² + 15)², the next prime’s square, falls), so the sieve uses the 64-bit version
        whenever it can and keeps the 128-bit one for the rest. Near 2⁶⁴, that alone made a
        batch on one thread about five times faster: from 2.6 seconds to under half a second.
      </p>
      <p>
        <strong>Planned, not built yet:</strong> a GPU version, using WebGPU, to test candidates
        further out. GPU shaders only have 32-bit integers, which is one reason the limbs are
        32 bits: the same representation will work there.
      </p>

      {/* 11 */}
      <SectionHeading id="proving-huge-primes" />
      <p>
        Miller–Rabin with the first 13 primes as bases is a proof only below
        3,317,044,064,679,887,385,961,981, and for a good reason: that number is composite, and
        it passes all 13. Past it, every number the partial sieve can’t cross off goes through
        two more stages before it can join the list.
      </p>
      <p>
        First, a fast filter: the <strong>Baillie–PSW</strong> test, one Miller–Rabin round with
        base 2 and a strong Lucas test. No composite is known that passes both, but nobody has
        proven that none exists, so a pass only makes a number a <em>probable</em> prime. A
        fail is a proof, though, and most composites fail at once. Each one thrown out is
        checked again on the TypeScript side, with its factor, its witness, or the Lucas test
        run again in <code>BigInt</code>.
      </p>
      <p>
        Then a real proof, with <strong>elliptic curve primality proving</strong> (ECPP, after
        Atkin and Morain). Take a curve <em>y</em>² = <em>x</em>³ + <em>ax</em> + <em>b</em>{" "}
        modulo <em>N</em>, and a point <em>Q</em> on it. Suppose that adding <em>Q</em> to
        itself <em>q</em> times gives the curve’s identity point, for a prime <em>q</em> with
      </p>
      <math display="block">
        <mi>q</mi>
        <mo>&gt;</mo>
        <msup>
          <mrow>
            <mo>(</mo>
            <msup>
              <mi>N</mi>
              <mrow>
                <mn>1</mn>
                <mo>/</mo>
                <mn>4</mn>
              </mrow>
            </msup>
            <mo>+</mo>
            <mn>1</mn>
            <mo>)</mo>
          </mrow>
          <mn>2</mn>
        </msup>
      </math>
      <p>
        Then <em>N</em> is prime. Take any prime factor <em>p</em> of <em>N</em>. Modulo{" "}
        <em>p</em>, the point still has order <em>q</em>, so the curve modulo <em>p</em> has at
        least <em>q</em> points. Hasse’s theorem says it has at most (√<em>p</em> + 1)², so
      </p>
      <math display="block">
        <msup>
          <mrow>
            <mo>(</mo>
            <msqrt>
              <mi>p</mi>
            </msqrt>
            <mo>+</mo>
            <mn>1</mn>
            <mo>)</mo>
          </mrow>
          <mn>2</mn>
        </msup>
        <mo>≥</mo>
        <mi>q</mi>
        <mo>&gt;</mo>
        <msup>
          <mrow>
            <mo>(</mo>
            <msup>
              <mi>N</mi>
              <mrow>
                <mn>1</mn>
                <mo>/</mo>
                <mn>4</mn>
              </mrow>
            </msup>
            <mo>+</mo>
            <mn>1</mn>
            <mo>)</mo>
          </mrow>
          <mn>2</mn>
        </msup>
        <mspace width="1em" />
        <mo>⟹</mo>
        <mspace width="1em" />
        <mi>p</mi>
        <mo>&gt;</mo>
        <msqrt>
          <mi>N</mi>
        </msqrt>
      </math>
      <p>
        Every prime factor of <em>N</em> is bigger than √<em>N</em>, which only a prime allows.
        That turns proving <em>N</em> into proving <em>q</em>, a smaller number, so the prover
        repeats the step on <em>q</em>, and again, until the number is below 3.3 × 10²⁴, where
        Miller–Rabin finishes the job. The list of curves, points and <em>q</em>s is a{" "}
        <strong>certificate</strong>: anyone can check it without redoing the search.
      </p>
      <p>
        The hard part is finding a curve whose number of points has a large prime factor. ECPP
        builds one from a discriminant <em>D</em> with 4<em>N</em> = <em>t</em>² + |<em>D</em>|
        <em>v</em>², using a root of a Hilbert class polynomial modulo <em>N</em>. The site
        computes those polynomials as it needs them, cheapest first, instead of keeping a
        table, so no table can run out. If a chain gets stuck, the prover backs up and tries
        another way down. A composite that slipped past Baillie–PSW never gets a certificate:
        it would stay pending, and the list would wait there rather than show it.
      </p>
      <p>
        Each certificate is then checked by a separate checker in TypeScript, written to be
        small enough to read, sharing no code with the C prover. It redoes every step with
        plain curve arithmetic and refuses any division that has no inverse modulo{" "}
        <em>N</em>, since that could only happen if <em>N</em> were composite. If a certificate
        doesn’t hold, the list stops with an error. So every prime shown past 3.3 × 10²⁴ has a
        proof that was checked independently. Software can’t rule out a hardware fault, or the
        same mistake made twice, but prover and checker would have to make it in two languages
        with no code in common.
      </p>
      <p>
        This is where the machine really starts losing. Measured natively on a laptop, on one
        thread, a proof takes about 0.09 seconds at 100 digits, 2.5 seconds at 200 and 31
        seconds at 300. Each thread proves a different prime at once, and each prime appears as
        soon as it and every prime before it are proven and checked. Meanwhile the row at that
        end of the list says “proving primality…”, with how long the prime has taken and how far
        down its chain has got. Stop pauses a proof instead of throwing it away: scroll on, or jump back, and it
        carries on where it was. Once primes take a minute or more each, the button says “Give
        up” instead. It does the same thing.
      </p>

      {/* 12 */}
      <SectionHeading id="displaying-long-primes" />
      <p>
        Every row in the list has the same height, 44 pixels. That’s what lets the list draw
        only the rows near the screen and still know exactly where every row is. So a prime too
        long for its row can’t wrap onto a second line. Instead it’s shortened in the middle,
        at the commas, keeping as many digit groups as fit from each end:
        18,446,744,…,551,629. The first and last groups always stay. Tap or click a shortened
        prime and a small popup shows every digit, how many there are, and a Copy button.
      </p>
      <p>
        How much fits is worked out without measuring each row. The primes are set in a font
        where every digit has the same width, so the list measures a digit, a comma and the
        “…” once, and again when the window changes size; the rest is arithmetic. Screen readers
        always get the whole number, and primes that fit are left exactly as they are. The
        frontier and records under the counter work the same way.
      </p>

      {/* 13 */}
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
          3 seconds (and at most 32 batches, so it still reacts when things slow down). Batches
          that measured 0 ms still count. Across many batches the rounding evens out, and far out,
          where primes arrive one or a few at a time, the counter is an average rather than a
          reading of the last one.
        </li>
        <li>
          <strong>Cross-origin isolation.</strong> The site sends the{" "}
          <code>Cross-Origin-Opener-Policy</code> and <code>Cross-Origin-Embedder-Policy</code>{" "}
          headers. In exchange for only loading resources it’s allowed to, the page gets a much
          finer timer. In Chrome it went from 0.1 ms steps to 0.005 ms.
        </li>
      </ul>
      <p>
        The counter measures the time spent finding primes, not wall-clock time: when you stop
        scrolling, the worker rests and the counter keeps its last value instead of sinking to
        zero. Setting up after a big jump is timed separately and left out, so the counter shows
        steady speed: building base primes, which can take a noticeable moment, and the brief
        timing runs that decide when to split a segment across threads or sieve partially. Once
        it sieves partially, finding a prime includes proving it, with Miller–Rabin or past
        3.3 × 10²⁴ an elliptic curve certificate, so that time counts; the separate check before
        anything is shown never does. A prime kept from an earlier proof wasn’t found just now,
        so it doesn’t count either. Below one prime a second, the counter shows how long each
        prime takes instead, like “42 s per prime”, since a rate there would just read 0.
      </p>

      {/* 14 */}
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
