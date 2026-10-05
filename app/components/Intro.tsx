export function Intro() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Every Prime Number</h1>
      <p className="mt-2 max-w-prose text-[0.95rem] leading-relaxed text-muted">
        Every Prime Number is an infinite list of prime numbers, calculated live in your
        browser. As you scroll, your computer finds the next primes on the spot using a
        segmented sieve of Eratosthenes, with no server and no precomputed list. Jump to any
        number to see the primes around it, and watch the primes-per-second counter fall as
        the numbers grow and your CPU works harder.
      </p>
    </>
  );
}
