import Link from "next/link";
import { pageMetadata } from "@/lib/pageMetadata";
import { Article } from "../components/Article";
import { PrimeChecker } from "../components/PrimeChecker";

export const metadata = pageMetadata({
  title: "Is it prime? Check any number, with a proof | Every Prime Number",
  description:
    "Type in any whole number, of any size. Your browser works out whether it’s prime and shows the evidence: a factor, a witness, or a proof it checked itself.",
  path: "/is-prime",
});

export default function IsPrimePage() {
  return (
    <Article
      title="Is it prime?"
      lead="Type in any whole number, as long as you like, or write it as 1e100 or 2^127 − 1. Your own computer works out whether it’s prime, and shows the evidence either way."
    >
      <PrimeChecker />

      <p>
        <strong>How does it decide?</strong> First it looks for a small factor: every prime below 65,536. Below 3.3 ×
        10²⁴, Miller–Rabin with fixed bases then settles it either way, and that’s a proof: it rests on a published
        computation of the smallest composite those bases let through. Past that, the Baillie–PSW test throws out
        composites with proof, and a number that passes is almost certainly prime. “Prove it” then builds an
        elliptic curve certificate and checks it: the same proof the list uses.
      </p>
      <p>
        <strong>How sure is the answer?</strong> Every answer comes with its evidence, checked again by separate,
        simpler code before it’s shown: a factor must divide the number, a witness must fail it, a certificate must
        pass the checker. That’s as certain as software gets: it can’t rule out a hardware fault, or the same mistake
        made in both places. A prime’s certificate can be downloaded and checked again, with the{" "}
        <Link href="/random-prime#check-a-certificate">certificate checker</Link> or a program of your own.
      </p>
      <p>
        <strong>How long does a proof take?</strong> On a laptop, under a second at 100 digits, a few seconds at 200,
        up to tens of seconds at 300, minutes at 500 and over an hour at 1,000; a phone is slower. A proof runs on one
        thread, and the page will try any size.
      </p>
      <p>
        <strong>Sharing.</strong> The number goes in the address bar (up to 100,000 digits), so you can send someone
        the link to your answer. A number written as a power, like 10^1000000, can be shared at any size.
      </p>
      <p>
        <Link href="/what-is-a-prime-number">New to primes? What is a prime number? →</Link>
      </p>
      <p>
        <Link href="/how-to-tell-if-a-number-is-prime">Want to do it by hand? How to tell if a number is prime →</Link>
      </p>
      <p>
        <Link href="/fun-facts">Fun facts about prime numbers →</Link>
      </p>
    </Article>
  );
}
