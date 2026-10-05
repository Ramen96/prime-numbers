# CLAUDE.md — Infinite Primes

## What this is

A deliberately absurd web app: an infinite scroll of prime numbers. As long as the user keeps scrolling, the app keeps computing primes. A big "primes per second" counter starts out ridiculous and slowly dies as the numbers get bigger, while a little CPU graphic visibly overheats. The joke is that the slowdown is mathematically honest.

It is also a portfolio piece, so the engineering should be clean and the reasoning documented.

## Deadline and scope

There is a demo on **Thursday**. Ship order matters more than ambition:

1. **MVP (must ship by Thursday):** pure TypeScript, CPU only, web worker, rolling buffer, primes-per-second counter, heat animation, deployed to Vercel.
2. **Phase 2:** swap the worker's compute core for C compiled to WebAssembly (Emscripten).
3. **Phase 3:** WebGPU path with feature detection and CPU fallback.

Do not start Phase 2 or 3 until the MVP works end to end and is deployed. A working simple version beats an ambitious broken one.

## Stack

- Next.js (App Router) + TypeScript, strict mode
- Web Worker for all prime computation (never compute on the main thread)
- Plain CSS / CSS modules for styling; animations driven by a CSS custom property
- Deploy: Vercel
- Later: C → WebAssembly via Emscripten; WebGPU compute shaders (WGSL)

## Working conventions

- The developer is experienced with TypeScript/JS and C. Don't over-explain basics.
- The front end is low-stakes and can be generated quickly. The worker, the windowing logic, and the worker↔main-thread messaging are the parts that matter. The developer may want to own the worker/compute layer, so ask before rewriting it wholesale.
- Keep the worker message protocol fully typed (shared types file imported by both sides).

## The math

**Primality bound:** to test whether `n` is prime, only trial-divide by primes up to `√n`. If `n = a × b`, one factor must be ≤ `√n`, so any larger divisor's partner would already have been caught.

**Batching = segmented sieve:** to find all primes in a range `[lo, hi)`, compute the base list of primes up to `√hi` once, then cross out multiples of each base prime inside the range. Whatever survives is prime. This is far cheaper than testing each number independently.

**Finding the next / previous prime** is just stepping through candidates and testing each; the square-root bound only governs the yes/no test. With the sieve, we work in ranges instead of single numbers.

**Base prime list:** grows extremely slowly (all primes under 1,000,000 cover every candidate up to 10¹²). Keep it in the worker and extend it lazily as the frontier moves outward.

## Architecture

### Rolling buffer (main thread / React state)

- Hold **3 batches of 500 primes** each (~1,500 primes live at any time).
- Track scroll progress through the batches.
- **Scrolling down:** when the user is **60%** through the third (last) batch, drop the first batch and request the next 500 primes from the worker, starting after the last prime held.
- **Scrolling up:** mirror image. When the user is 60% back into the first batch, drop the last batch and request the 500 primes immediately *before* the first prime held.
- If scrolling up reaches 2, stop; there is nothing before it.
- Scrolling back up simply recomputes. That's intentional: memory stays flat forever; only compute grows.
- Consider moving the threshold earlier (e.g. 50%) once batch compute times get long, so the worker has enough runway.
- Use a virtualized list so DOM node count stays bounded too.

### Worker

- Receives requests like `{ direction: "next" | "prev", from: number, count: 500 }`.
- Sieves segments in the requested direction until it has `count` primes, then posts them back.
- A batch is a fixed number of *primes*, so the number of segments sieved per batch varies.
- Reuse one preallocated `Uint8Array` as the sieve scratch buffer; clear and refill it per segment instead of allocating new arrays (avoids GC churn).
- Time each batch with `performance.now()` and return the duration alongside the primes.

### No throttling, but no pointless work

The whole point is to make the CPU work. Don't add artificial caps or sleeps. The worker runs flat out whenever primes are actually needed. The only restraint is that it computes **on demand** (driven by the buffer), not racing ahead into regions nobody has scrolled to. Because it runs in a worker, the page stays responsive even when the worker is pegged.

## Number limits

- JS `number` is only exact up to 2⁵³ − 1 (`Number.MAX_SAFE_INTEGER`, ~9 × 10¹⁵).
- Nobody will realistically scroll that far, but the code must not silently return wrong primes. In the MVP, guard against crossing `MAX_SAFE_INTEGER` (show a joke "you broke math" state). Optionally switch to `BigInt` later (correct but much slower).
- Memory is not the bottleneck at any realistic distance. Compute is. Eventually the next prime just never arrives, which is the ending of the joke.

## Primes-per-second counter

- Display in **primes per second** (not ns/candidate), as a big, absurd, fast-changing number.
- Compute from the worker's batch timings: `primesInBatch / (durationMs / 1000)`. Smooth it (e.g. exponential moving average) so it doesn't flicker unreadably.
- Browsers don't expose real CPU usage (fingerprinting protections), so batch timing is the honest proxy.

## Heat animation

- Derive a single `heat` value from 0 to 1 from the primes-per-second rate (high rate = cool, low rate = hot). Use a log scale, since the rate decays across orders of magnitude.
- Set it as a CSS custom property (`--heat`) on a root element. All visuals key off that one variable.
- Color shifts cool blue → orange → angry pulsing red as heat rises.
- Small cartoon CPU with heat-shimmer lines and sweat drops. Animation speed is also tied to the rate: frantic when fast, slow and labored as it dies.
- Keep animations in CSS (transforms/opacity) so they stay smooth.

## Phase 2: WebAssembly (C)

- Write the segmented sieve in C, compile with Emscripten to `.wasm`, load it inside the worker.
- Keep the worker's message protocol identical so the UI doesn't change.
- Pass the scratch buffer via Wasm linear memory rather than copying per call where practical.

## Phase 3: WebGPU

- **Feature detect** on load (`navigator.gpu` and a successful `requestAdapter()`). If unavailable, use CPU for everything.
- If available: start on CPU (GPU setup overhead isn't worth it for small numbers), then **switch to GPU once the frontier passes 15,485,863** (the 1,000,000th prime). Hardcode this threshold.
- User setting to force CPU mode, which overrides the switch.
- GPU model: upload a slab of candidate numbers plus the base prime list; each shader invocation tests one candidate by trial division against the base primes; read back the results.
- Show a badge indicating the current mode (CPU / GPU). GPU users get bragging rights.
- Watch for precision limits: WGSL has no 64-bit integers by default, so plan the number representation before building this.

## README (for the portfolio)

- Open with the joke: one or two sentences plus a GIF of the counter dying.
- Link the live Vercel deployment at the very top.
- Architecture section explaining *why*: the √n bound, segmented sieve batching, the rolling buffer and flat memory, on-demand compute instead of throttling, the 2⁵³ limit, and the CPU→GPU handoff.
