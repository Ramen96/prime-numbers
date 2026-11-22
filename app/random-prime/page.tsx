import { pageMetadata } from "@/lib/pageMetadata";
import { Article } from "../components/Article";
import { RandomPrime } from "../components/RandomPrime";

// Provisional (random prime, step c1): its text, nav link and sitemap entry come
// in step c3, for the developer's review. noIndex until then.
export const metadata = pageMetadata({
  title: "A random prime | Every Prime Number",
  description: "A random prime with as many digits as you like, proven in your browser.",
  path: "/random-prime",
  noIndex: true,
});

export default function RandomPrimePage() {
  return (
    <Article title="A random prime">
      <RandomPrime />
    </Article>
  );
}
