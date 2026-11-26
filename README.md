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

JavaScript numbers are exact only up to 2^53, so primes are `BigInt` everywhere outside the C code. Inside it, a window below 2^64 uses `uint64_t` (the fast path), and anything bigger becomes an array of 32-bit limbs, least significant first. There's no maximum in the code; the browser's own BigInt limit (2^30 bits, about 323 million digits in Chromium) is the only one.

The sieve needs only a few big-number operations, and one does the real work: **big mod small**, the remainder that says where a base prime's first multiple lands in a window. After that, everything inside a window is a small offset, so the inner marking loop never touches a big number.

While the base prime is below 2^32, that remainder uses 64-bit arithmetic. WebAssembly has no 128-bit division, so the general version calls a software routine; switching made batches near 2^64 about five times faster. Results cross into JavaScript as a base (limbs) plus small offsets, rebuilt with `(result << 32n) | limb`, never through a JS number.

### The rolling buffer: three batches, and why three

The page never holds more than 1,500 primes: three batches of 500. Scroll 60% into the last batch and the next 500 are requested; when they arrive, the first batch is dropped and the scroll position moves by exactly the rows removed, so nothing on screen jumps. Scrolling up mirrors it.

Three, not two, so that after every swap the view sits in the middle batch, far from both fetch thresholds. With two, the view would land right next to a threshold and the buffer would thrash.

Scrolling back up recomputes primes instead of storing them: memory stays flat forever and only compute grows, which is the point of the site. The exception is past 3.3 × 10^24, where a prime costs a proof: the worker keeps primes it has proven and checked (`lib/primes/provenPrimeCache.ts`, about 16 MB, oldest dropped first) so they aren't proven again. The list is virtualized with a fixed row height, so a prime too long for its row is shortened in the middle at comma groups and opens in full on tap.

A jump can go anywhere (`?jump=` links are shareable), typed out or written as `1e100`, `1.5e3` or `2^127 - 1` (`lib/wholeNumberExpression.ts` reads them exactly, in BigInt; a link keeps that form when it's shorter than the digits), and `lib/destinations.ts` lists some places worth a visit: /fun-facts shows them, and “Take me somewhere interesting” picks one at random, never one where every prime takes seconds to prove.

### A memory budget, and partial sieving past it

The budget is a quarter of the device's memory where the browser reports it. A proven lower bound on π(x) (Dusart) decides up front whether a jump's base primes could possibly fit; if so, their storage is reserved from an li(x) estimate, in one allocation. If an allocation still fails part way, the base primes roll back to exactly how they were.

Past a point measured on the device, or sooner if the base primes don't fit, the sieve stops building them: it sieves each window with a small set, and every survivor it can't settle, those from (M + 1)² up for base primes up to M, is proven by a deterministic Miller–Rabin test in C (`wasm/primality.c`, on hand-written Montgomery arithmetic), shared across the threads, with small numbers' memory cached per thread because the allocator's lock otherwise made 9 threads slower than one. Proving a prime costs the same however large the sieve was, so this wins by a long way: near 2^63, about 2 ms a batch instead of 39 ms, and 4 MB of base primes instead of 150 MB.

The worker measures rather than assumes: on the first batch past 2^32 it times real batches both ways up a ladder of sizes (`lib/primes/methodCalibration.ts`), stopping where partial sieving is clearly faster, then times a few caps and keeps the fastest; past 2^64 it times the caps again for the multi-limb path. Batches from the same place must hold identical primes, or the worker stops with an error, so calibrating also cross-checks the methods. That's a proof only below a(13) ≈ 3.3 × 10^24 (OEIS A014233); past it, every survivor needs a primality proof (below). WebAssembly memory never shrinks, so a jump back from far away starts a fresh worker to give the memory back.

### Verification: an independent second opinion

Every prime is checked again before it's shown, by a deterministic Miller–Rabin test written in TypeScript. It shares no code with the C sieve, so a bug in one is caught by the other. With the first 13 primes as bases, it's proven to have no false positives below about 3.3 × 10^24 (OEIS A014233); past that, each prime's certificate is checked instead. Every composite the C side's Miller–Rabin throws out comes with its evidence (a small factor or a witness base), checked again too, so a prime thrown out by mistake can't go missing silently.

If the two ever disagree, the worker stops with an error and the disputed batch is never shown. Big batches are checked in parallel in plain workers, and the time is reported separately from sieving.

### Proofs past 3.3 × 10^24

Past a(13), the sieve's survivors go through BPSW in C (`bpsw()` in `wasm/primality.c`): a base-2 strong test and a strong Lucas test. A fail is proof of a composite, re-checked in TypeScript; a pass is only a probable prime. Each one is then proven by elliptic curve primality proving (`wasm/ecpp_prover.c`): a chain of curves, each showing a point of prime order q > (N^¼ + 1)², down to a number below a(13). Curves come from Hilbert class polynomials computed at run time (`wasm/classpoly.c`), so there's no table to run out. Each thread has two provers (`wasm/proof_slots.c`), each on a different prime; the second only works while the GPU strips numbers that big (below), so that one proves while the other waits.

Every certificate is checked before the prime is shown by `lib/primes/primalityCertificate.ts`, a small checker that shares no code with the prover. A composite that passed BPSW never gets a proof, so it stays pending and the list waits rather than show it. Measured natively on one thread, a proof takes about 0.06 s at 100 digits, 0.8 s at 200 and 6 s at 300.

Each prime is shown as soon as it and every prime before it are proven and checked: the worker sends a batch in pieces (`proven` messages, at most every 100 ms), after checking the batch's rejected composites first, since a wrong rejection would leave a gap. Meanwhile a "proving primality…" row shows how long the prime the list is waiting on has taken, and how far down its chain has got (`proof_slot_progress`). Stop pauses proving instead of ending the worker: unfinished chains stay in their slots, and a later request for the same numbers carries on from there. Once primes take a minute or more each (`primesTakeMinutes` in `lib/heat.ts`), the button reads "Give up"; it does the same thing. While the sieve itself is running, a Wasm call can't be interrupted, so Stop still ends the worker.

### Stripping on the GPU

Each step of a proof needs a curve whose order is a large prime times small factors, so the prover divides small primes out of many candidate orders ("stripping"). Stripping deeper means fewer curves to try and shorter chains, but on the CPU it costs more than it saves. With WebGPU it runs on the GPU instead (`lib/primes/gpuStripping.ts`): a WGSL shader gives each GPU thread one prime and runs it along an order a 32-bit limb at a time with Montgomery reduction, about 50 billion limb steps a second on an Apple M4 GPU. It runs in a worker of its own (`gpuStripping.worker.ts`, `remoteGpuStripper.ts`), and nothing it says is trusted: each factor is checked with one division, one order in 64 is trial-divided on the CPU up to 10,000 to catch a missed factor, and any error, wrong answer or call that doesn't come back within 5 seconds (`GPU_CALL_TIMEOUT_MS`) switches it off for the session. A missed factor can only slow a proof; the certificate is checked either way.

Where it's used follows a rule measured on the device it was built on (`lib/primes/stripDepth.ts`): numbers below about 75 digits strip on the CPU, since a trip to the GPU costs about 2 ms; above that, to 10^6, and to 10^7 from about 145 digits. A single proof (`/is-prime`, `/random-prime`) has nothing to do while it waits, so it uses the GPU only from 135 digits. Measured in Chromium on an Apple M4 laptop, the list is 1.07× faster near 10^80, 1.30× near 10^100, 1.56× near 10^150 and 1.81× near 10^200, and a single proof is 1.06× faster at 135 digits and 1.51× at 300; below those sizes the GPU isn't used. It's on by default where WebGPU has a hardware adapter (`lib/gpuAdapter.ts`: a fallback or software adapter such as SwiftShader or llvmpipe counts as none), except in Firefox for now, where proofs were seen to hang with it on, so it starts off there; there's a switch in the home page's stats (`lib/gpuPreference.ts`, kept in `localStorage`); where WebGPU isn't available the switch is greyed out and the CPU does everything. The e2e tests run the GPU path on SwiftShader, a software GPU (`--enable-unsafe-webgpu`, the `webgpu` Playwright project), made to say it's hardware through the DevTools protocol (`tests/e2e/hardwareGpuStandIn.ts`); `gpuSoftwareOnly.spec.ts` checks that SwiftShader as it is gets refused.

### A random prime, with its certificate

`/random-prime` asks the same prime worker for one prime from a uniformly random start (`lib/randomStart.ts`, `crypto.getRandomValues`), with `includeCertificates`: the worker sends the certificate `checkCertificate` accepted along with the prime. The page shows each step and offers it as JSON (`lib/certificateExport.ts`, numbers as decimal strings) or text, or copies the text to the clipboard. At least 26 digits, so every prime has a certificate; no maximum. A proof runs on one thread. Its "Check a certificate" section reads either format back (`readCertificate`) and checks it with `checkCertificate` in a worker of its own (`certificateCheck.worker.ts`), naming the step that fails if one does. Wherever a certificate is shown (here, after “Prove it” on `/is-prime`, and on the pre-built pages), it says in plain words what it proves, offers its downloads before the steps, and links to that checker (“Check it yourself”).

### Is it prime?

`/is-prime` checks any number in a worker of its own (`primeCheck.worker.ts`, the single-threaded build): a factor below 65,536 found in BigInt, then `check_number` (`wasm/number_check.c`: deterministic Miller–Rabin below a(13), BPSW above). Every answer's evidence is checked again in BigInt (`answerHolds` in `lib/primeCheck.ts`) before it's shown. A BPSW pass is shown as almost certainly prime, and "Prove it" proves it with a proof slot, its certificate checked by `checkCertificate`. The number goes in `?n=`, and can be written the same ways as a jump.

The numbers in `lib/listedNumbers.ts` (0 to 1,000, the years 1900 to 2100, and some notable ones) also have a page of their own, `/is-prime/<n>`, built ahead of time with the answer in the HTML. The build settles each one with `public/sieve.wasm` in Node and the same re-check (`lib/listedAnswers.ts`). A listed prime past a(13) is proven by its committed certificate in `data/listed-certificates/`, written by `npm run prove:listed` and checked by the build: a missing or wrong one fails it.

### Threads: splitting a window's base primes

A batch of 500 primes almost always fits in one window, so giving each thread its own window would mostly sieve windows nobody asked for. Instead, all threads share one window, each crossing off with its own slice of the base primes (starting at a checkpoint), and their marks are merged.

Splitting only pays once a window needs many base primes, so the worker measures where that starts on the device, from both directions, at most a dozen times. Building base primes is split the other way: one whole window per thread, each thread encoding its own gaps.

The sieve uses one thread fewer than the cores, so the page keeps one for scrolling. Sieving fully near 2^63 on a 10-core laptop, a batch drops from 158 ms to 39 ms. The threaded build is checked with ThreadSanitizer.

### The single-threaded fallback

Threads need `SharedArrayBuffer` (so the page is cross-origin isolated with COOP/COEP headers), nested workers, and a shared memory the browser agrees to reserve. iOS Safari refuses 4 GB, so the worker asks for the budget, then halves it.

If any of that fails, including a thread whose script doesn't load, the worker falls back to a standalone single-threaded build of the same C file: identical primes, just slower. The threaded build's Emscripten loader is served from `/public` and imported at run time, not bundled, because it starts its thread workers from its own URL.

### The speed counter

Browsers round `performance.now()` (0.1 ms or coarser) to blunt timing attacks, and early batches finish faster than that. Two fixes:

- **A window of batches.** The rate is total primes over total time across recent batches: at least 3 s of them, at most 32. Far out, where primes arrive a few at a time, that makes it an average rather than a reading of the last piece.
- **Cross-origin isolation.** Already needed for threads, it also gives a finer timer: about 5 µs in Chrome.

The counter measures the time spent finding primes, which includes proving past the full sieve: Miller–Rabin, and past 3.3 × 10^24, ECPP. Primes kept from an earlier proof don't count, and below one prime a second it shows the time per prime instead (`lib/formatRate.ts`). Building base primes, calibrating, timing thread splits and verification are measured separately and left out, so the counter shows steady speed and holds its value while you aren't scrolling. The CPU's heat follows the rate on a log scale, since the rate falls across orders of magnitude. Once heat is at its top (about 10^24), the chip starts melting, and it's a puddle at one prime every ten minutes (`lib/heat.ts`).

## Setup

### Dependencies

| What | Needed for | Notes |
|---|---|---|
| Node.js 22 or newer | everything | The unit tests run TypeScript directly with Node's built-in test runner. Developed on Node 24. |
| npm packages | everything | `npm install` |
| Playwright's Chromium | `npm run test:e2e` | `npx playwright install chromium` |
| Emscripten | `npm run build:wasm`, `npm run test:wasm` | Developed with 7.0.0 (`brew install emscripten` on macOS; see emscripten.org elsewhere). Only needed to change the C: both builds are committed. |
| A C compiler with `unsigned __int128` | `npm run test:native` | clang or gcc on a 64-bit machine. |
| ThreadSanitizer | `npm run test:native:tsan` | Built into clang on macOS (and gcc/clang on Linux). |

### First run

```bash
npm install
npx playwright install chromium
npm run dev        # http://localhost:3000
```

On a new machine, check everything works with `npm test` and `npm run test:e2e`.

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

The native tests (`tests/native/run.sh`) compile `wasm/sieve.c`, `wasm/bignum.c` and `wasm/primality.c` with the system C compiler: the sieve is checked against an independent Miller–Rabin primality test (with partial sieving forced by small caps, every number passed over must be a reported prime, crossed off, or rejected with valid evidence), the multi-limb arithmetic against `unsigned __int128`, and the C Miller–Rabin against a plain sieve, strong pseudoprimes and Carmichael numbers. The sieve runs single-threaded, then multi-threaded with every window split across 3 and 8 threads and a checkpoint every 7 base primes (so thread slices start and end in thousands of places), then with the split measured as the app does it.

`npm run test:wasm` compiles `wasm/bignum.c` and `wasm/primality.c` to WebAssembly with a small test harness and checks them against JavaScript BigInt, at up to 1,000 limbs for the arithmetic and against the app's own verifier for Miller–Rabin. It also builds `wasm/sieve.c` with a 16 MB memory ceiling, so a real allocation failure inside WebAssembly can be tested: the base primes must roll back and every later prime must still be right. The committed multi-threaded build runs in Node too (Emscripten's threads become `worker_threads`), checked the same way with 8 threads, including a real allocation failure in a small shared memory.

Prime counts are checked against published values of π(x) (OEIS A006880, A007053), and the sieve against known record prime gaps (OEIS A005250, A002386).
