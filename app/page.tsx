import { pageMetadata } from "@/lib/pageMetadata";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { firstPrimes } from "@/lib/primes/sieveOfEratosthenes";
import { BATCH_SIZE } from "@/lib/primes/protocol";
import { verifyPrimes } from "@/lib/primes/verifyPrimes";
import { InfinitePrimes } from "./components/InfinitePrimes";
import { Intro } from "./components/Intro";
import { JsonLd } from "./components/JsonLd";

const PAGE_TITLE = "Every Prime Number | Live Infinite List of Primes";
const PAGE_DESCRIPTION =
  "An infinite, scrollable list of prime numbers calculated live in your browser. Jump to any number and watch your CPU work harder as the primes get bigger.";

export const metadata = pageMetadata({ title: PAGE_TITLE, description: PAGE_DESCRIPTION, path: "/" });

const WEBSITE_DATA = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
  description: PAGE_DESCRIPTION,
};

const WEB_APPLICATION_DATA = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: SITE_URL,
  description: PAGE_DESCRIPTION,
  applicationCategory: "EducationalApplication",
  operatingSystem: "Any",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

// Computed once at build time: the page is static, so these primes are in
// the HTML for crawlers and for an instant first screen.
// Verified independently too (Requirement A3): if the build-time sieve were
// ever wrong, the build fails instead of shipping it.
const firstBatchVerification = verifyPrimes(firstPrimes(BATCH_SIZE).map(BigInt));
if (!firstBatchVerification.verified) {
  throw new Error(`The first batch includes ${firstBatchVerification.disputedPrime}, which isn't prime.`);
}
// Passed as strings: a server component can't hand BigInt to a client component.
const FIRST_BATCH = firstPrimes(BATCH_SIZE).map(String);

export default function Home() {
  return (
    <>
      <JsonLd data={WEBSITE_DATA} />
      <JsonLd data={WEB_APPLICATION_DATA} />
      <InfinitePrimes intro={<Intro />} firstBatchFromServer={FIRST_BATCH} />
    </>
  );
}
