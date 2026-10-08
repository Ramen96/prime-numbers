# Every Prime Number

**Live: [everyprimenumber.com](https://everyprimenumber.com)**

A website that promises every prime number, in order, and keeps the promise by calculating them on your own computer as you scroll. A primes-per-second counter and a little cartoon CPU show it slowly losing to math, and the slowdown is real: primes really do get harder to find.

<!-- TODO(owner): record a GIF of the counter dying (jump to 2^63, then keep scrolling) and replace the line below with it. -->
> **TODO:** GIF of the counter dying goes here.

It's a joke built with real engineering. Two rules shape everything:

1. **Every prime, in order, with no composites and none skipped.**
2. **The code is never the limit.** Only the device (memory, time, browser caps) decides how far it gets.

The prime finder, `wasm/sieve.c`, is written in C and compiled to WebAssembly with Emscripten. The site is Next.js (App Router) and TypeScript, deployed on Vercel. [How it works](https://everyprimenumber.com/how-it-works) explains the math for a general audience; this README explains the design.

## Architecture

### Finding primes: the √n bound and a segmented sieve

If `n = a × b` with `a ≤ b`, then `a ≤ √n`. So to find every prime in a range `[low, high)`, you only need the **base primes** up to `√high`: cross off their multiples, and whatever survives is prime. That's the sieve of Eratosthenes, run on one fixed-size window at a time (a segmented sieve).

A window covers 65,536 numbers but holds only the odd ones, so its scratch buffer is 32 KB wherever it is on the number line. Memory for sieving stays flat; only the base primes grow, with the square root of the numbers.

### Base primes as halved gaps

Covering everything below 2^64 takes every prime below 2^32: 203,280,221 of them, 813 MB even as 32-bit integers. Gaps between odd primes are even, so the sieve stores each gap halved, in one byte: 4× smaller. A rare gap over 510 is escaped into 9 bytes, so nothing caps the gap size. (The first gap that big comes after 304,599,508,537.)

Every 65,536th base prime also gets a saved read position (a checkpoint), so several threads can each start reading the list part way through.

### Numbers of any size

JavaScript numbers are exact only up to 2^53, so primes are `BigInt` everywhere outside the C code. Inside it, a window below 2^64 uses `uint64_t` (the fast path), and anything bigger becomes an array of 32-bit limbs, least significant first. There's no maximum.

The sieve needs only a few big-number operations, and one does the real work: **big mod small**, the remainder that says where a base prime's first multiple lands in a window. After that, everything inside a window is a small offset, so the inner marking loop never touches a big number.

While the base prime is below 2^32, that remainder uses 64-bit arithmetic. WebAssembly has no 128-bit division, so the general version calls a software routine; switching made batches near 2^64 about five times faster. Results cross into JavaScript as a base (limbs) plus small offsets, rebuilt with `(result << 32n) | limb`, never through a JS number.

### The rolling buffer: three batches, and why three

The page never holds more than 1,500 primes: three batches of 500. Scroll 60% into the last batch and the next 500 are requested; when they arrive, the first batch is dropped and the scroll position moves by exactly the rows removed, so nothing on screen jumps. Scrolling up mirrors it.

Three, not two, so that after every swap the view sits in the middle batch, far from both fetch thresholds. With two, the view would land right next to a threshold and the buffer would thrash.

Scrolling back up recomputes primes instead of storing them: memory stays flat forever and only compute grows, which is the point of the site. The list is virtualized with a fixed row height, so a prime too long for its row is shortened in the middle at comma groups and opens in full on tap.

### A memory budget, and an honest stop

The budget is a quarter of the device's memory where the browser reports it. A proven lower bound on π(x) (Dusart) decides up front whether a jump's base primes could possibly fit; if not, the list shows the memory-limit notice at once instead of building for minutes. Otherwise their storage is reserved from an li(x) estimate, in one allocation.

If an allocation still fails part way, the base primes roll back to exactly how they were, and the list stops at the last proven prime and says so. Nothing is skipped or guessed. WebAssembly memory never shrinks, so a jump back from far away starts a fresh worker to give the memory back.

### Verification: an independent second opinion

Every prime is checked again before it's shown, by a deterministic Miller–Rabin test written in TypeScript. It shares no code with the C sieve, so a bug in one is caught by the other. With the first 13 primes as bases, it's proven to have no false positives below about 3.3 × 10^24 (OEIS A014233), far beyond what fits in a browser's memory.

If the two ever disagree, the worker stops with an error and the disputed batch is never shown. Big batches are checked in parallel in plain workers, and the time is reported separately from sieving.

### Threads: splitting a window's base primes

A batch of 500 primes almost always fits in one window, so giving each thread its own window would mostly sieve windows nobody asked for. Instead, all threads share one window, each crossing off with its own slice of the base primes (starting at a checkpoint), and their marks are merged.

Splitting only pays once a window needs many base primes, so the worker measures where that starts on the device, from both directions, at most a dozen times. Building base primes is split the other way: one whole window per thread, each thread encoding its own gaps.

The sieve uses one thread fewer than the cores, so the page keeps one for scrolling. Near 2^63 on a 10-core laptop, a batch drops from 158 ms to 39 ms. The threaded build is checked with ThreadSanitizer.

### The single-threaded fallback

Threads need `SharedArrayBuffer` (so the page is cross-origin isolated with COOP/COEP headers), nested workers, and a shared memory the browser agrees to reserve. iOS Safari refuses 4 GB, so the worker asks for the budget, then halves it.

If any of that fails, including a thread whose script doesn't load, the worker falls back to a standalone single-threaded build of the same C file: identical primes, just slower. The threaded build's Emscripten loader is served from `/public` and imported at run time, not bundled, because it starts its thread workers from its own URL.

### The speed counter

Browsers round `performance.now()` (0.1 ms or coarser) to blunt timing attacks, and early batches finish faster than that. Two fixes:

- **A window of batches.** The rate is total primes over total time across recent batches: at least 50 ms of them, at most 32.
- **Cross-origin isolation.** Already needed for threads, it also gives a finer timer: about 5 µs in Chrome.

The counter measures sieving time only. Building base primes, timing thread splits and verification are measured separately and left out, so the counter shows steady sieving speed and holds its value while you aren't scrolling. The CPU's heat follows the rate on a log scale, since the rate falls across orders of magnitude.

## Roadmap

- **Partial sieve plus deterministic Miller–Rabin.** When the base primes no longer fit, sieve each window with as many as do, then test the survivors with Miller–Rabin using a proven base set. Survivor tests are planned to run on the GPU (WebGPU, 32-bit limbs), with CPU workers as the fallback.
- **Proofs past 3.3 × 10^24.** Beyond the proven Miller–Rabin bound: BPSW as a fast filter, then a primality proof for every candidate before it's shown (trial division first, ECPP later), with certificates checked by an independent verifier.

## Setup

Requires Node.js 22 or newer (the unit tests run TypeScript directly with Node's built-in test runner).

```bash
npm install
npm run dev        # http://localhost:3000
```

### The WebAssembly sieve

The prime finder is `wasm/sieve.c` (with `wasm/bignum.c`), compiled twice: a multi-threaded build in `public/sieve-threads/` (`sieve.mjs` and `sieve.wasm`, Emscripten pthreads, used where the browser allows shared memory and nested workers) and a single-threaded fallback, `public/sieve.wasm`. **Both builds are committed to the repo**, because Vercel's build machines don't have Emscripten. Rebuild them whenever you change `wasm/sieve.c` or `wasm/bignum.c`, and commit the results:

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

The native tests (`tests/native/run.sh`) compile `wasm/sieve.c` and `wasm/bignum.c` with the system C compiler: the sieve is checked against an independent Miller–Rabin primality test, and the multi-limb arithmetic against `unsigned __int128`. The sieve runs single-threaded, then multi-threaded with every window split across 3 and 8 threads and a checkpoint every 7 base primes (so thread slices start and end in thousands of places), then with the split measured as the app does it.

`npm run test:wasm` compiles `wasm/bignum.c` to WebAssembly with a small test harness and checks it against JavaScript BigInt at sizes up to 8,192 bits. It also builds `wasm/sieve.c` with a 16 MB memory ceiling, so a real allocation failure inside WebAssembly can be tested: the base primes must roll back and every later prime must still be right. The committed multi-threaded build runs in Node too (Emscripten's threads become `worker_threads`), checked the same way with 8 threads, including a real allocation failure in a small shared memory.

Prime counts are checked against published values of π(x) (OEIS A006880, A007053), and the sieve against known record prime gaps (OEIS A005250, A002386).
