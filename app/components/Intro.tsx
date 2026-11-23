export function Intro() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Every Prime Number</h1>
      <p className="mt-2 max-w-prose text-[0.95rem] leading-relaxed text-muted">
        An endless list of prime numbers, worked out by your own computer as you scroll. No
        server does the math: only the first 500 primes come with the page. The further you go,
        the harder each prime is to find, so watch the primes-per-second counter fall and the CPU
        heat up. The list only stops when your device gives up.
      </p>
    </>
  );
}
