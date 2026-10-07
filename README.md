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
npm test           # unit tests (TypeScript) + native tests for wasm/sieve.c (needs a C compiler: cc)
npm run test:e2e   # Playwright end-to-end tests at phone and desktop sizes (starts the dev server)
```

The native tests compile `wasm/sieve.c` with the system C compiler and check `sieve_next` and `sieve_prev` against an independent Miller–Rabin primality test.
