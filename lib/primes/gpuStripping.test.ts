import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LARGEST_GPU_PRIME, montgomeryRemainder, multiplyHigh, negatedInverse, OddPrimeList } from "./gpuStripping.ts";
import { primalityTableBelow } from "./sieveOfEratosthenes.ts";

// The shader can't run in Node (no WebGPU), so these test its arithmetic through
// the JavaScript mirror, step for step the same, against BigInt.

const toBigInt = (limbs: Uint32Array) => limbs.reduceRight((value, limb) => (value << 32n) | BigInt(limb), 0n);

function powerMod(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  base %= modulus;
  for (; exponent > 0n; exponent >>= 1n) {
    if (exponent & 1n) result = (result * base) % modulus;
    base = (base * base) % modulus;
  }
  return result;
}

/** What the kernel should give: N · 2^(−32·limbs) mod p. */
function expectedRemainder(limbs: Uint32Array, p: number): bigint {
  const modulus = BigInt(p);
  const inverseOfPower = powerMod(powerMod(2n, 32n * BigInt(limbs.length), modulus), modulus - 2n, modulus);
  return ((toBigInt(limbs) % modulus) * inverseOfPower) % modulus;
}

/** A seeded generator, so a failure can be repeated. */
function randomWords(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const high = state;
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return ((high & 0xffff0000) | (state >>> 16)) >>> 0;
  };
}

function isPrime(value: number): boolean {
  if (value < 2 || value % 2 === 0) return value === 2;
  for (let divisor = 3; divisor * divisor <= value; divisor += 2) if (value % divisor === 0) return false;
  return true;
}

/** Primes at every edge the arithmetic has: the smallest, around 2^16, 2^24, 2^28, 2^30, and the largest below 2^31. */
const EDGE_PRIMES = [3, 5, 7, 65_521, 65_537, 16_777_213, 16_777_259, 268_435_399, 268_435_459, 1_073_741_789, 1_073_741_827];
for (let candidate = LARGEST_GPU_PRIME; EDGE_PRIMES.length < 16; candidate -= 2) if (isPrime(candidate)) EDGE_PRIMES.push(candidate);

const next = randomWords(11);
const RANDOM_PRIMES: number[] = [];
while (RANDOM_PRIMES.length < 40) {
  const candidate = (next() % (LARGEST_GPU_PRIME - 3)) | 1;
  if (candidate > 2 && isPrime(candidate)) RANDOM_PRIMES.push(candidate);
}
const PRIMES = [...EDGE_PRIMES, ...RANDOM_PRIMES];

/** Orders that reach every case: 0, 1, all ones (every T carries), alternating limbs, random ones, of 1 to 200 limbs. */
function testOrders(): Uint32Array[] {
  const orders: Uint32Array[] = [];
  for (const limbs of [1, 2, 3, 11, 32, 52, 104, 200]) {
    orders.push(new Uint32Array(limbs));
    orders.push(Uint32Array.from({ length: limbs }, (_, index) => (index === 0 ? 1 : 0)));
    orders.push(new Uint32Array(limbs).fill(0xffff_ffff));
    orders.push(Uint32Array.from({ length: limbs }, (_, index) => (index % 2 === 0 ? 0xffff_ffff : 0)));
    for (let count = 0; count < 3; count++) orders.push(Uint32Array.from({ length: limbs }, () => next()));
  }
  return orders;
}

describe("GPU stripping's arithmetic (the shader's steps, in JavaScript)", () => {
  it("takes the high half of a 32 × 32-bit product", () => {
    const values = [0, 1, 0xffff, 0x1_0000, 0x7fff_ffff, 0x8000_0000, 0xffff_ffff, ...Array.from({ length: 200 }, next)];
    for (const a of values) {
      for (const b of values) assert.equal(multiplyHigh(a, b), Number((BigInt(a) * BigInt(b)) >> 32n), `${a} × ${b}`);
    }
  });

  it("finds −p⁻¹ mod 2³² for every test prime", () => {
    for (const p of PRIMES) assert.equal((BigInt(p) * BigInt(negatedInverse(p))) % 2n ** 32n, 2n ** 32n - 1n, `p = ${p}`);
  });

  it("gives N · 2^(−32·limbs) mod p exactly, at every edge", () => {
    for (const order of testOrders()) {
      for (const p of PRIMES) {
        assert.equal(BigInt(montgomeryRemainder(order, p)), expectedRemainder(order, p), `p = ${p}, ${order.length} limbs`);
      }
    }
  });

  it("gives 0 exactly when p divides the order, whatever zero limbs pad it", () => {
    for (const p of PRIMES) {
      for (const limbs of [1, 5, 40]) {
        const value = toBigInt(Uint32Array.from({ length: limbs }, () => next()));
        for (const candidate of [value - (value % BigInt(p)), value - (value % BigInt(p)) + 1n]) {
          if (candidate < 0n) continue;
          const words = new Uint32Array(limbs + 3); // three zero limbs at the top
          for (let index = 0, rest = candidate; index < words.length; index++, rest >>= 32n) words[index] = Number(rest & 0xffff_ffffn);
          const divides = candidate % BigInt(p) === 0n;
          assert.equal(montgomeryRemainder(words, p) === 0, divides, `p = ${p}`);
          assert.equal(montgomeryRemainder(words.subarray(0, limbs), p) === 0, divides, `p = ${p}, unpadded`);
        }
      }
    }
  });
});

describe("OddPrimeList", () => {
  it("lists exactly the odd primes, across segment boundaries, however it's extended", () => {
    const table = primalityTableBelow(300_001);
    const expected = [];
    for (let value = 3; value <= 300_000; value++) if (table[value]) expected.push(value);
    const list = new OddPrimeList(1000); // small segments: many boundaries
    for (const largest of [2, 3, 4, 97, 1000, 1001, 999, 65_537, 300_000, 150_000]) {
      assert.deepEqual(Array.from(list.upTo(largest)), expected.filter((prime) => prime <= largest), `up to ${largest}`);
    }
  });

  it("counts π(10⁷) − 1 odd primes below 10⁷ (664,578), with the default segments", () => {
    assert.equal(new OddPrimeList().upTo(10_000_000).length, 664_578);
  });
});
