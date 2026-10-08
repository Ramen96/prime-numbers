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

The prime finder is `wasm/sieve.c`, compiled twice: a multi-threaded build in `public/sieve-threads/` (`sieve.mjs` and `sieve.wasm`, Emscripten pthreads, used where the browser allows shared memory and nested workers) and a single-threaded fallback, `public/sieve.wasm`. **Both builds are committed to the repo**, because Vercel's build machines don't have Emscripten. Rebuild them whenever you change `wasm/sieve.c` or `wasm/bignum.c`, and commit the results:

```bash
brew install emscripten   # once (macOS); see emscripten.org for other platforms
npm run build:wasm        # both builds (or build:wasm:standalone / build:wasm:threads)
```

`npm run build` (and Vercel) only builds the Next.js app; it never compiles the C.

### Tests

```bash
npm test                  # unit tests (TypeScript), native C tests (needs cc) and Wasm tests (needs emcc)
npm run test:e2e          # Playwright end-to-end tests at phone and desktop sizes (starts the dev server)
npm run test:native:slow  # native tests around 2^64, single- and multi-threaded (~30 s, ~230 MB: base primes up to 2^32)
npm run test:native:tsan  # the native tests multi-threaded under ThreadSanitizer, checking for data races (~25 min)
npm run test:e2e:slow     # end-to-end tests tagged @slow, around 2^64 (desktop only)
```

The native tests (`tests/native/run.sh`) compile `wasm/sieve.c` and `wasm/bignum.c` with the system C compiler: the sieve is checked against an independent Miller–Rabin primality test, and the multi-limb arithmetic against `unsigned __int128`. The sieve runs single-threaded, then multi-threaded with every window split across 3 and 8 threads and a checkpoint every 7 base primes (so thread slices start and end in thousands of places), then with the split measured as the app does it. `npm run test:wasm` compiles `wasm/bignum.c` to WebAssembly with a small test harness and checks it against JavaScript BigInt at sizes up to 8,192 bits. It also builds `wasm/sieve.c` with a 16 MB memory ceiling, so a real allocation failure inside WebAssembly can be tested: the base primes must roll back and every later prime must still be right. The committed multi-threaded build runs in Node too (Emscripten's threads become `worker_threads`), checked the same way with 8 threads, including a real allocation failure in a small shared memory.
