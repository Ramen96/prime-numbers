import { InfinitePrimes } from "./components/InfinitePrimes";
import { Intro } from "./components/Intro";

export default function Home() {
  // Intro is rendered on the server and passed in, so its text is in the HTML.
  return <InfinitePrimes intro={<Intro />} />;
}
