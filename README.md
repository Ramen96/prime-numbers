# Every Prime Number

An infinite list of prime numbers, calculated live in your browser with a segmented sieve of Eratosthenes compiled from C to WebAssembly.

<!-- TODO: the portfolio intro (the joke, a GIF of the counter dying, the live link) and the architecture write-up described in CLAUDE.md. -->

## Setup

Requires Node.js 22 or newer (the unit tests run TypeScript directly with Node's built-in test runner).

```bash
npm install
npm run dev        # http://localhost:3000
```

### The WebAssembly sieve

The prime finder is `wasm/sieve.c`, compiled to `public/sieve.wasm`. **The compiled `public/sieve.wasm` is committed to the repo**, because Vercel's build machines don't have Emscripten. Rebuild it whenever you change `wasm/sieve.c`, and commit the result:

```bash
brew install emscripten   # once (macOS); see emscripten.org for other platforms
npm run build:wasm
```

`npm run build` (and Vercel) only builds the Next.js app; it never compiles the C.

### Tests

```bash
npm test                  # unit tests (TypeScript), native C tests (needs cc) and Wasm tests (needs emcc)
npm run test:e2e          # Playwright end-to-end tests at phone and desktop sizes (starts the dev server)
npm run test:native:slow  # native tests around 2^64 (~16 s, ~230 MB: base primes up to 2^32)
npm run test:e2e:slow     # end-to-end tests tagged @slow, around 2^64 (desktop only)
```

The native tests compile `wasm/sieve.c` and `wasm/bignum.c` with the system C compiler: the sieve is checked against an independent Miller–Rabin primality test, and the multi-limb arithmetic against `unsigned __int128`. `npm run test:wasm` compiles `wasm/bignum.c` to WebAssembly with a small test harness and checks it against JavaScript BigInt at sizes up to 8,192 bits. It also builds `wasm/sieve.c` with a 16 MB memory ceiling, so a real allocation failure inside WebAssembly can be tested: the base primes must roll back and every later prime must still be right.
