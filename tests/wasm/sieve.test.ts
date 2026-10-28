// The shipped public/sieve.wasm, through the same WasmSieve boundary the
// worker uses. Every prime is re-checked with an independent Miller–Rabin
// test in BigInt (Requirement A3), and consecutive batches must tile the
// number line with nothing skipped (Requirement A2).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { NO_SIEVE_PRIME_CAP, WasmSieve, type RawSieveExports, type RejectedComposite } from "../../lib/primes/wasmSieve.ts";
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

// ── partial sieving + Miller–Rabin (Phase 4) ─────────────────────────────

/** a(13) (OEIS A014233): from here up, Miller–Rabin proves nothing. */
const PROVEN_BOUND = 3_317_044_064_679_887_385_961_981n;

/** Whether `base` is a Miller–Rabin witness that odd `candidate` is composite, in BigInt. */
function isWitness(candidate: bigint, base: bigint): boolean {
  let oddPart = candidate - 1n;
  let powersOfTwo = 0;
  while ((oddPart & 1n) === 0n) {
    oddPart >>= 1n;
    powersOfTwo++;
  }
  let value = 1n;
  for (let power = base % candidate, rest = oddPart; rest > 0n; rest >>= 1n, power = (power * power) % candidate)
    if (rest & 1n) value = (value * power) % candidate;
  if (value === 1n || value === candidate - 1n) return false;
  for (let round = 1; round < powersOfTwo; round++) {
    value = (value * value) % candidate;
    if (value === candidate - 1n) return false;
  }
  return true;
}

/** Each rejected number lies in (low, high), isn't prime, and its evidence proves it composite. */
function assertRejectedProven(rejected: RejectedComposite[], low: bigint, high: bigint) {
  for (const { candidate, evidence } of rejected) {
    const context = `${candidate} (evidence ${evidence})`;
    assert.ok(candidate > low && candidate < high, `${context} is in the range covered`);
    assert.equal(isPrime(candidate), false, `${context} isn't prime`);
    const divides = evidence > 1 && candidate % BigInt(evidence) === 0n && candidate !== BigInt(evidence);
    assert.ok(divides || isWitness(candidate, BigInt(evidence)), `${context}: the evidence holds`);
  }
}

describe("partial sieving in the shipped sieve.wasm, cap 65,535", () => {
  const partialInstance = new WebAssembly.Instance(sieveModule, { env: { emscripten_notify_memory_growth: () => {} } });
  const partialRaw = partialInstance.exports as unknown as RawSieveExports;
  partialRaw._initialize?.();
  const partial = new WasmSieve(partialRaw);
  partial.setSievePrimeCap(65_535n);

  for (const [label, start] of [
    ["10^20", 10n ** 20n],
    ["2^64 − 20,000 (into multi-limb windows)", 2n ** 64n - 20_000n],
    ["10^24", 10n ** 24n],
  ] as const) {
    it(`next, from ${label}: consecutive proven primes, every rejected composite proven`, () => {
      const batch = partial.findPrimes("next", start, 500);
      assert.equal(batch.primes.length, 500);
      assert.equal(batch.reachedMemoryLimit, false);
      assert.equal(batch.reachedProvenBound, false);
      assertConsecutivePrimes(batch.primes, start);
      assert.ok(batch.rejected.length > 0, "Miller–Rabin rejected some survivors");
      assertRejectedProven(batch.rejected, start, batch.primes[499]);
    });

    it(`prev, from ${label}: consecutive going down, every rejected composite proven`, () => {
      const batch = partial.findPrimes("prev", start, 500);
      assert.equal(batch.primes.length, 500);
      let expected: bigint | null = start;
      for (const prime of [...batch.primes].reverse()) {
        expected = previousPrimeBefore(expected!);
        assert.equal(prime, expected);
      }
      assertRejectedProven(batch.rejected, batch.primes[0], start);
    });
  }

  it("stops at the proven bound, a(13): every prime below it, then pending, saying why", () => {
    const start = PROVEN_BOUND - 3_000n;
    const batch = partial.findPrimes("next", start, 500);
    assert.ok(batch.primes.length > 0 && batch.primes.length < 500);
    assert.ok(batch.primes.every((prime) => prime < PROVEN_BOUND));
    assertConsecutivePrimes(batch.primes, start);
    assert.equal(batch.reachedProvenBound, true);
    assert.equal(batch.reachedMemoryLimit, false);

    const fromAbove = partial.findPrimes("prev", PROVEN_BOUND + 3_000n, 500);
    assert.deepEqual(fromAbove.primes, []);
    assert.equal(fromAbove.reachedProvenBound, true);
  });

  it("with no cap again, sieves fully: nothing left for Miller–Rabin to reject", () => {
    partial.setSievePrimeCap(NO_SIEVE_PRIME_CAP);
    const batch = partial.findPrimes("next", 10n ** 12n, 500);
    assertConsecutivePrimes(batch.primes, 10n ** 12n);
    assert.deepEqual(batch.rejected, []);
  });
});
