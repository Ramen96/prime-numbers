import Link from "next/link";
import { shortNumber } from "@/lib/certificateCheck";
import { listedAnswers } from "@/lib/listedAnswers";
import { listedNeighbours, listedNumber, listedNumbers } from "@/lib/listedNumbers";
import { pageMetadata } from "@/lib/pageMetadata";
import { listedPageDescription, listedPageTitle } from "@/lib/primeCheck";
import { Article } from "../../components/Article";
import { PrimeCheckAnswer } from "../../components/PrimeCheckAnswer";
import { PrimeChecker } from "../../components/PrimeChecker";

// A listed number's own page (lib/listedNumbers.ts), built ahead of time with
// its answer in the HTML: settled at build time by lib/listedAnswers.ts, which
// fails the build on any answer that doesn't hold. Only listed numbers have a
// page; any other number is checked in the browser at /is-prime?n=.

export const dynamicParams = false;

export function generateStaticParams() {
  return listedNumbers().map(({ value }) => ({ n: String(value) }));
}

interface Params {
  params: Promise<{ n: string }>;
}

function answerFor(n: string) {
  const value = BigInt(n);
  const answer = listedAnswers().get(value);
  if (!answer) throw new Error(`${n} isn't a listed number`); // dynamicParams is false: never reached
  return { value, answer };
}

export async function generateMetadata({ params }: Params) {
  const { n } = await params;
  const { answer } = answerFor(n);
  return pageMetadata({ title: listedPageTitle(answer), description: listedPageDescription(answer), path: `/is-prime/${n}` });
}

export default async function ListedNumberPage({ params }: Params) {
  const { n } = await params;
  const { value, answer } = answerFor(n);
  const { previous, next } = listedNeighbours(value);
  return (
    <Article title={`Is ${shortNumber(value)} prime?`}>
      <PrimeCheckAnswer answer={answer} elapsedMs={null} note={listedNumber(value)?.note} builtAhead />
      <p className="text-sm text-muted">
        Settled when this page was built, the same way the checker below works, and checked again before it went in.
      </p>
      {/* long neighbours share a narrow screen: each may wrap */}
      <nav aria-label="Nearby numbers" className="mt-4 flex justify-between gap-4 text-sm [overflow-wrap:anywhere]">
        {previous !== null ? (
          <Link href={`/is-prime/${previous}`} className="min-w-0">
            ← {shortNumber(previous)}
          </Link>
        ) : (
          <span />
        )}
        {next !== null && (
          <Link href={`/is-prime/${next}`} className="min-w-0 text-right">
            {shortNumber(next)} →
          </Link>
        )}
      </nav>

      <h2>Check another number</h2>
      <PrimeChecker onListedPage />
    </Article>
  );
}
