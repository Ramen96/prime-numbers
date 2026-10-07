// The shipped public/sieve.wasm, through the same WasmSieve boundary the
// worker uses. Every prime is re-checked with an independent Miller–Rabin
// test in BigInt (Requirement A3), and consecutive batches must tile the
// number line with nothing skipped (Requirement A2).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { WasmSieve, type RawSieveExports } from "../../lib/primes/wasmSieve.ts";
import { isPrime, nextPrimeAfter, previousPrimeBefore } from "../support/primality.ts";

const sieveModule = new WebAssembly.Module(readFileSync("public/sieve.wasm"));
const instance = new WebAssembly.Instance(sieveModule, { env: { emscripten_notify_memory_growth: () => {} } });
const raw = instance.exports as unknown as RawSieveExports;
raw._initialize?.();
const sieve = new WasmSieve(raw);

/** Every prime is prime, and each follows the one before with nothing skipped. */
function assertConsecutivePrimes(primes: bigint[], startingAfter: bigint) {
  let previous = startingAfter;
  for (const prime of primes) {
    assert.ok(prime > 0n, "never negative");
    assert.equal(prime, nextPrimeAfter(previous), `the prime after ${previous}`);
    previous = prime;
  }
}

describe("the shipped sieve.wasm", () => {
  it("can grow to 4 GiB, all a wasm32 module can address, and no further", () => {
    // a separate instance: growing is virtual until written, but it never shrinks
    const fresh = new WebAssembly.Instance(sieveModule, { env: { emscripten_notify_memory_growth: () => {} } });
    const memory = fresh.exports.memory as WebAssembly.Memory;
    const pageBytes = 65_536;
    memory.grow(2 ** 32 / pageBytes - memory.buffer.byteLength / pageBytes);
    assert.equal(memory.buffer.byteLength, 2 ** 32);
    assert.throws(() => memory.grow(1), RangeError);
  });

  it("has no test hooks built in", () => {
    const exportNames = WebAssembly.Module.exports(sieveModule).map((entry) => entry.name);
    assert.ok(!exportNames.some((name) => name.includes("force")), exportNames.join(", "));
  });

  for (const [label, start] of [
    ["0", 0n],
    ["2^32 − 5,000 (one limb to two)", 2n ** 32n - 5000n],
    ["10^12", 10n ** 12n],
    ["2^53 − 10,000 (the old limit)", 2n ** 53n - 10_000n],
    ["10^17", 10n ** 17n],
  ] as const) {
    it(`next, from ${label}: two consecutive batches of proven primes`, () => {
      const first = sieve.findPrimes("next", start, 500);
      assert.equal(first.primes.length, 500);
      assert.equal(first.reachedMemoryLimit, false);
      const second = sieve.findPrimes("next", first.primes[499], 500);
      assertConsecutivePrimes([...first.primes, ...second.primes], start);
    });

    it(`prev, from ${label}: batches going down tile with nothing skipped`, () => {
      const before = start + 30_000n;
      const upper = sieve.findPrimes("prev", before, 500);
      const lower = sieve.findPrimes("prev", upper.primes[0], 500);
      const primes = [...lower.primes, ...upper.primes];
      assert.ok(primes.every(isPrime));
      assert.equal(upper.primes.at(-1), previousPrimeBefore(before));
      assertConsecutivePrimes(primes.slice(1), primes[0]);
    });
  }

  it("finds the published record gap of 1184 above 2^53, both ways", () => {
    // Maximal prime gaps: OEIS A005250 (gap) and A002386 (prime that starts it), entry 65.
    const prime = 43_841_547_845_541_059n;
    assert.deepEqual(sieve.findPrimes("next", prime, 1).primes, [prime + 1184n]);
    assert.deepEqual(sieve.findPrimes("prev", prime + 1184n, 1).primes, [prime]);
  });
});
