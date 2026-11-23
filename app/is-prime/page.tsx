import { pageMetadata } from "@/lib/pageMetadata";
import { Article } from "../components/Article";
import { PrimeChecker } from "../components/PrimeChecker";

// Provisional (step 4a): not indexed or linked until its copy is approved (4c).
export const metadata = pageMetadata({
  title: "Is it prime? | Every Prime Number",
  description: "Type in any number. Your browser decides whether it’s prime, and shows the proof either way.",
  path: "/is-prime",
  noIndex: true,
});

export default function IsPrimePage() {
  return (
    <Article title="Is it prime?" lead="Type in any number. Your browser decides whether it’s prime, and shows the proof either way.">
      <PrimeChecker />
    </Article>
  );
}
