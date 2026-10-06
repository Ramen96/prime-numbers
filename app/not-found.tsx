import Link from "next/link";
import type { Metadata } from "next";
import { Article } from "./components/Article";

export const metadata: Metadata = {
  title: "404: Page not found | Every Prime Number",
};

export default function NotFound() {
  return (
    <Article title="404 is not prime">
      <p>
        404 = 2² × 101, so it isn’t prime. This page isn’t anything, either: it doesn’t exist.
      </p>
      <p>
        <Link href="/">Back to the primes →</Link>
      </p>
    </Article>
  );
}
