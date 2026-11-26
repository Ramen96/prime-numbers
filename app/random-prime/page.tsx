import Link from "next/link";
import { pageMetadata } from "@/lib/pageMetadata";
import { Article } from "../components/Article";
import { CertificateCheck } from "../components/CertificateCheck";
import { RandomPrime } from "../components/RandomPrime";

export const metadata = pageMetadata({
  title: "A random prime, with its proof | Every Prime Number",
  description:
    "Pick how many digits. Your browser finds a random prime that long, proves it with an elliptic curve certificate, checks the proof, and shows you every step.",
  path: "/random-prime",
});

export default function RandomPrimePage() {
  return (
    <Article
      title="A random prime, with its proof"
      lead="Choose how many digits. Your own computer finds a random prime that long, proves it’s prime, and shows the proof."
    >
      <p>
        Most “random prime” generators run a probable-prime test and stop there: a number that passes is almost
        certainly prime, but nothing shows it. This page goes further. Every prime it shows comes with an elliptic
        curve certificate, a chain of facts that proves it prime, and your browser checks that certificate with a
        separate, simpler checker before the prime appears. You can download the certificate and check it yourself.
      </p>
      <p>
        That’s as certain as software gets: it can’t rule out a hardware fault, or the same mistake made by both the
        prover and the checker.
      </p>

      <RandomPrime />

      <p>
        <strong>How random is it?</strong> The page picks a number with that many digits uniformly at random, using
        your browser’s cryptographic random generator, and then shows the first prime from there. So a prime that
        comes right after a long gap between primes is a little more likely to be picked than one that comes right
        after another prime.
      </p>
      <p>
        <strong>How long does it take?</strong> On a laptop, under a second at 100 digits, a few seconds at 200, about
        ten seconds at 300, minutes at 500 and over an hour at 1,000; a phone is slower. A proof runs on one thread: each step
        of the chain starts from the one before, so it can’t be spread across cores the way the list’s many primes
        are.
      </p>
      <p>
        <strong>At least 26 digits,</strong> because every smaller prime is proven a simpler way (Miller–Rabin with
        fixed bases), which leaves no certificate to show. There’s no largest: the page will try any length you’re
        patient enough for.
      </p>

      <CertificateCheck />

      <p>
        <Link href="/is-prime">Got a number of your own? Check whether it’s prime →</Link>
      </p>
    </Article>
  );
}
