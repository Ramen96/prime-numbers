import { primalityTableBelow } from "@/lib/primes/sieveOfEratosthenes";

/** Every number from 1 to 100, primes marked: the grid on /what-is-a-prime-number. */
const LAST_NUMBER = 100;

// inline, to override the article's list and link styles (.prose ol, .prose a), which outrank utilities
const LIST_STYLE = { listStyle: "none", paddingLeft: 0 } as const;
const PRIME_LINK_STYLE = { textDecoration: "none", color: "var(--heat-text)" } as const;
const OTHER_LINK_STYLE = { textDecoration: "none", color: "var(--muted)" } as const;

/**
 * The numbers 1 to 100, five to a row on phones (so every cell is a 44 px tap
 * target) and ten from 640 px. A prime is bold, in the heat colour, on a tinted
 * cell, and says “prime” in its name, so colour isn't the only sign. Each number
 * links to its own page (/is-prime/<n>). Built on the server, from the sieve.
 */
export function PrimesTo100() {
  const isPrime = primalityTableBelow(LAST_NUMBER + 1);
  const numbers = Array.from({ length: LAST_NUMBER }, (_, index) => index + 1);
  return (
    <ol
      aria-label="The numbers from 1 to 100, primes marked"
      style={LIST_STYLE}
      className="my-6 grid grid-cols-5 gap-1 sm:grid-cols-10"
      data-testid="primes-to-100"
    >
      {numbers.map((number) => {
        const prime = isPrime[number] === 1;
        return (
          <li key={number} className="m-0!" data-prime={prime || undefined}>
            <a
              href={`/is-prime/${number}`}
              style={prime ? PRIME_LINK_STYLE : OTHER_LINK_STYLE}
              aria-label={prime ? `${number}, prime` : String(number)}
              className={`flex h-11 items-center justify-center rounded-md border tabular-nums focus-visible:outline-2 focus-visible:outline-(--heat-text) ${
                prime
                  ? "border-(--heat-text) bg-(--heat-text)/10 font-bold"
                  : "border-rule"
              }`}
            >
              {number}
            </a>
          </li>
        );
      })}
    </ol>
  );
}
