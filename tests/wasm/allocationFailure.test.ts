// A real allocation failure, not a simulated one. `npm run test:wasm` builds
// the unchanged wasm/sieve.c with a 16 MB memory ceiling
// (.cache/sieve_small_memory.wasm) and no budget set, so growing the base
// primes eventually makes realloc return NULL inside Wasm. That must go
// through the same rollback as exceeding the budget: the base primes go back
// to how they were, the space they used is free again, and every prime
// reported afterwards is still right.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { WasmSieve, type RawSieveExports } from "../../lib/primes/wasmSieve.ts";
import { nextPrimeAfter } from "../support/primality.ts";

const MEMORY_CEILING_BYTES = 16 * 2 ** 20; // -sMAXIMUM_MEMORY in the test:wasm build

function loadSmallMemorySieve() {
  const sieveModule = new WebAssembly.Module(readFileSync(".cache/sieve_small_memory.wasm"));
  const instance = new WebAssembly.Instance(sieveModule, { env: { emscripten_notify_memory_growth: () => {} } });
  const raw = instance.exports as unknown as RawSieveExports;
  raw._initialize?.();
  return new WasmSieve(raw);
}

function assertConsecutivePrimes(primes: bigint[], startingAfter: bigint) {
  let previous = startingAfter;
  for (const prime of primes) {
    assert.equal(prime, nextPrimeAfter(previous), `the prime after ${previous}`);
    previous = prime;
  }
}

describe("a real allocation failure in Wasm", () => {
  const sieve = loadSmallMemorySieve();

  it("rolls the base primes back when realloc fails", () => {
    assert.equal(sieve.extendBasePrimes(10_000_000n), true); // about 660 KB
    const limitBefore = sieve.basePrimeLimit();

    // base primes below 10^10 would take about 455 MB: realloc fails part way
    assert.equal(sieve.extendBasePrimes(10_000_000_000n), false);
    assert.equal(sieve.basePrimeLimit(), limitBefore);
    assert.ok(sieve.moduleMemoryBytes() <= MEMORY_CEILING_BYTES);
    assert.ok(sieve.moduleMemoryBytes() > MEMORY_CEILING_BYTES / 2, "it really did grow until it couldn't");

    // the bytes the failed extension wrote are free again: a small extension
    // fits without any new allocation (none would succeed now)
    const bytesHeld = sieve.basePrimeMemoryBytes();
    assert.equal(sieve.extendBasePrimes(limitBefore + 1_000_000n), true);
    assert.equal(sieve.basePrimeMemoryBytes(), bytesHeld);
  });

  it("reports the memory limit for a batch that needs more, with nothing guessed", () => {
    const batch = sieve.findPrimes("next", 10n ** 20n, 500); // needs base primes up to 10^10
    assert.deepEqual(batch, { primes: [], reachedMemoryLimit: true, measuringMs: 0 });
  });

  it("still finds exactly the right primes afterwards", () => {
    for (const start of [0n, 10n ** 9n, 10n ** 13n]) {
      const batch = sieve.findPrimes("next", start, 500);
      assert.equal(batch.reachedMemoryLimit, false);
      assert.equal(batch.primes.length, 500);
      assertConsecutivePrimes(batch.primes, start);
    }
  });
});
