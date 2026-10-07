import Link from "next/link";
import { anchorForQuestion, DATA_FAQ_QUESTION } from "@/lib/faqAnchors";
import { pageMetadata } from "@/lib/pageMetadata";
import { AUTHOR_NAME, AUTHOR_URL, GITHUB_URL } from "@/lib/site";
import { Article } from "../components/Article";

export const metadata = pageMetadata({
  title: "About | Every Prime Number",
  description:
    "Why Every Prime Number exists, who built it, and answers to common questions: is it using my computer, what does ≈ mean, and why does it slow down?",
  path: "/about",
});

const FREQUENTLY_ASKED_QUESTIONS = [
  {
    question: "Does it really calculate every prime number?",
    answer: (
      <>
        It calculates every prime, in order, for as long as you keep scrolling, and nothing is
        skipped or looked up from a list. But there are infinitely many primes (Euclid proved
        it, see <Link href="/how-it-works#infinitely-many-primes">how it works</Link>), so
        “every” is the joke: you’ll never reach the end.
      </>
    ),
  },
  {
    question: "Is it using my computer?",
    answer: (
      <>
        Yes. Every prime you scroll or jump to is calculated in your browser, on your device;
        no server does any of that work. The one exception is the first 500 primes, which are
        worked out once when the site is built and written into the page, so the list appears
        instantly.
      </>
    ),
  },
  {
    question: DATA_FAQ_QUESTION,
    answer: (
      <>
        No. There are no analytics, trackers or accounts, and nothing you do on the page is
        sent anywhere. The site saves your favorite primes and scroll records in your browser
        so they’re there next time, along with a note that you’ve seen the notice about this.
        They stay on this device and are never sent anywhere; clearing your browser’s site
        data removes them. Like any website, the host sees the ordinary request for the page
        when you load it.
      </>
    ),
  },
  {
    question: "Why does the counter slow down as I scroll?",
    answer: (
      <>
        Because primes get rarer as numbers get bigger. Near a million, about one number in 14
        is prime; near a trillion, about one in 28. Each number also takes more work to rule
        out. So the further you go, the longer each batch of 500 primes takes, and the
        primes-per-second counter falls. The slowdown is real math, not a special effect.
      </>
    ),
  },
  {
    question: "What does the “≈” next to a number mean?",
    answer: (
      <>
        After you jump, the site doesn’t know exactly how many primes it skipped, so the
        position labels (#n) are estimates, made with the logarithmic integral. They’re very
        close: about 0.0001% off at a trillion. Scroll back down to 2 and they become exact.{" "}
        <Link href="/how-it-works#estimated-positions">More on how it estimates.</Link>
      </>
    ),
  },
  {
    question: "Why can’t I jump past a certain number?",
    answer: (
      <>
        The sieve stops at 2⁵³ − 1 (9,007,199,254,740,991): that’s where its base primes, the
        primes it crosses off with, stop growing. The primes themselves are 64-bit integers that
        stay exact much further, but for now, that’s where the list ends.
      </>
    ),
  },
  {
    question: "Will it break my computer?",
    answer: (
      <>
        No. It works your processor hard while it’s calculating, but it does so in a background
        worker, so the page stays responsive and you can stop at any time. It only computes when
        you scroll toward primes it doesn’t have yet; when you stop, it rests.
      </>
    ),
  },
];

export default function AboutPage() {
  return (
    <Article title="About Every Prime Number">
      <p>
        It started as a deliberately absurd idea: a website that lists every prime number. An
        infinite scroll, with your own computer working out each prime on the spot, a big
        primes-per-second counter, and a little cartoon CPU that gets visibly hotter the further
        you go.
      </p>
      <p>
        Doing that properly turned into a real engineering project: a prime finder running in
        a background thread, a list that scrolls forever without memory growing, position
        estimates good to a ten-thousandth of a percent, and a fight with the browser’s own
        timers just to measure the speed honestly.{" "}
        <Link href="/how-it-works">How it works</Link> explains all of it.
      </p>
      <p>
        Built by <a href={AUTHOR_URL}>{AUTHOR_NAME}</a>. The source code is on{" "}
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        .
      </p>

      <h2 id="faq">Frequently asked questions</h2>
      {FREQUENTLY_ASKED_QUESTIONS.map(({ question, answer }) => (
        <section key={question}>
          <h3 id={anchorForQuestion(question)}>{question}</h3>
          <p>{answer}</p>
        </section>
      ))}
    </Article>
  );
}
