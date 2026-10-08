// The shipped threaded build (public/sieve-threads/), run in Node, where
// Emscripten's threads are worker_threads, through the same WasmSieve
// boundary the browser uses. Every prime is re-checked independently
// (Requirement A3) and consecutive batches must tile (A2), with every window
// split across 8 threads, and with the split left to be measured as in the app.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { rawExportsOf, THREADED_INITIAL_MEMORY_BYTES, type CreateSieveModule } from "../../lib/primes/threadedSieveModule.ts";
import { WasmSieve } from "../../lib/primes/wasmSieve.ts";
import { nextPrimeAfter, previousPrimeBefore } from "../support/primality.ts";

const { default: createSieveModule } = (await import(
  pathToFileURL("public/sieve-threads/sieve.mjs").href
)) as { default: CreateSieveModule };

const PAGE = 65_536;
const MiB = 2 ** 20;

async function loadThreadedSieve(threads: number, maximumBytes = 4 * 2 ** 30) {
  const wasmMemory = new WebAssembly.Memory({
    initial: THREADED_INITIAL_MEMORY_BYTES / PAGE,
    maximum: maximumBytes / PAGE,
    shared: true,
  });
  const sieveModule = await createSieveModule({ wasmMemory, sieveHelperThreads: threads - 1 });
  assert.equal(sieveModule._sieve_start_helpers(threads - 1), threads - 1);
  return { sieveModule, sieve: new WasmSieve(rawExportsOf(sieveModule)) };
}

function assertConsecutivePrimes(primes: bigint[], startingAfter: bigint) {
  let previous = startingAfter;
  for (const prime of primes) {
    assert.equal(prime, nextPrimeAfter(previous), `the prime after ${previous}`);
    previous = prime;
  }
}

const STARTS: [string, bigint][] = [
  ["0", 0n],
  ["2^32 − 5,000", 2n ** 32n - 5000n],
  ["10^12", 10n ** 12n],
  ["2^53 − 10,000", 2n ** 53n - 10_000n],
  ["2^63 − 20,000", 2n ** 63n - 20_000n],
  ["2^64 − 10,000 (into multi-limb windows)", 2n ** 64n - 10_000n],
];

for (const [mode, splitEveryWindow] of [
  ["every window split across 8 threads", true],
  ["the split measured, as in the app", false],
] as const) {
  describe(`the threaded sieve, ${mode}`, async () => {
    const { sieveModule, sieve } = await loadThreadedSieve(8);
    if (splitEveryWindow) sieveModule._set_parallel_threshold(1);

    for (const [label, start] of STARTS) {
      it(`tiles next and prev batches from ${label}, every prime proven`, () => {
        const first = sieve.findPrimes("next", start, 500);
        assert.equal(first.primes.length, 500);
        const second = sieve.findPrimes("next", first.primes[499], 500);
        assertConsecutivePrimes([...first.primes, ...second.primes], start);
        const below = sieve.findPrimes("prev", first.primes[0], 500).primes;
        if (start > 3n) assert.equal(below.at(-1), previousPrimeBefore(first.primes[0]));
      });
    }

    if (!splitEveryWindow) {
      it("measured where splitting pays, after windows that need millions of base primes", () => {
        assert.ok(sieveModule._measured_parallel_threshold() > 0);
      });
    }
  });
}

describe("the threaded sieve's memory", () => {
  it("grows by what's needed, not 20% more (all but a few MB is base primes)", async () => {
    const { sieve } = await loadThreadedSieve(4);
    const limit = 3_100_000_000n; // the base primes for 2^63
    assert.ok(sieve.reserveBasePrimeStorage(155 * MiB));
    assert.ok(sieve.extendBasePrimes(limit));
    const overhead = sieve.moduleMemoryBytes() - sieve.basePrimeMemoryBytes();
    assert.ok(overhead < 20 * MiB, `module minus base primes: ${(overhead / MiB).toFixed(1)} MB`);
  });

  it("rolls back when the shared memory's maximum is reached, and stays right", async () => {
    // a real allocation failure: the memory can't grow past 64 MB, and no budget is set
    const { sieve } = await loadThreadedSieve(4, 64 * MiB);
    assert.ok(sieve.extendBasePrimes(10_000_000n));
    const limitBefore = sieve.basePrimeLimit();
    assert.equal(sieve.extendBasePrimes(10_000_000_000n), false); // would need about 455 MB
    assert.equal(sieve.basePrimeLimit(), limitBefore);
    assert.ok(sieve.moduleMemoryBytes() <= 64 * MiB);
    assert.deepEqual(sieve.findPrimes("next", 10n ** 20n, 500), { primes: [], reachedMemoryLimit: true, measuringMs: 0 });
    const batch = sieve.findPrimes("next", 10n ** 13n, 500);
    assert.equal(batch.reachedMemoryLimit, false);
    assertConsecutivePrimes(batch.primes, 10n ** 13n);
  });
});
