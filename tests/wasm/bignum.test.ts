// Randomized tests of wasm/bignum.c at large sizes, against JavaScript BigInt
// as the independent reference (CLAUDE.md, Requirement B). The module is the
// test harness built by `npm run test:wasm` (tests/wasm/bignum_harness.c).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

interface Harness {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  harness_first_input(): number;
  harness_second_input(): number;
  harness_output(): number;
  harness_compare(firstCount: number, secondCount: number): number;
  harness_add_small(count: number, value: bigint): number;
  harness_subtract_small(count: number, value: bigint): number;
  harness_mod_small(count: number, divisor: bigint): bigint;
  harness_square_root_upper(count: number): number;
  harness_bit_length(count: number): number;
  harness_third_input(): number;
  harness_second_output(): number;
  harness_second_output_count(): number;
  harness_add(firstCount: number, secondCount: number): number;
  harness_subtract(firstCount: number, secondCount: number): number;
  harness_multiply(firstCount: number, secondCount: number): number;
  harness_shift_left(count: number, bits: number): number;
  harness_shift_right(count: number, bits: number): number;
  harness_divide(dividendCount: number, divisorCount: number): number;
  harness_power_mod(baseCount: number, exponentCount: number, modulusCount: number): number;
}

const { instance } = await WebAssembly.instantiate(readFileSync(".cache/bignum_harness.wasm"), {
  env: { emscripten_notify_memory_growth: () => {} },
});
const exports = instance.exports as unknown as Harness;
exports._initialize?.();

// Wasm integers reach JavaScript as *signed* values: a uint64_t of 2^63 or
// more arrives as a negative BigInt, and size_t (32 bits) as a signed number.
// Reinterpret them as unsigned, as the C code means them.
const harness: Harness = {
  ...exports,
  harness_mod_small: (count, divisor) => BigInt.asUintN(64, exports.harness_mod_small(count, divisor)),
  harness_add_small: (count, value) => exports.harness_add_small(count, value) >>> 0,
  harness_subtract_small: (count, value) => exports.harness_subtract_small(count, value) >>> 0,
  harness_square_root_upper: (count) => exports.harness_square_root_upper(count) >>> 0,
  harness_bit_length: (count) => exports.harness_bit_length(count) >>> 0,
  harness_first_input: () => exports.harness_first_input() >>> 0,
  harness_second_input: () => exports.harness_second_input() >>> 0,
  harness_output: () => exports.harness_output() >>> 0,
  harness_compare: (firstCount, secondCount) => exports.harness_compare(firstCount, secondCount),
  harness_third_input: () => exports.harness_third_input() >>> 0,
  harness_second_output: () => exports.harness_second_output() >>> 0,
  harness_second_output_count: () => exports.harness_second_output_count() >>> 0,
  harness_add: (firstCount, secondCount) => exports.harness_add(firstCount, secondCount) >>> 0,
  harness_subtract: (firstCount, secondCount) => exports.harness_subtract(firstCount, secondCount) >>> 0,
  harness_multiply: (firstCount, secondCount) => exports.harness_multiply(firstCount, secondCount) >>> 0,
  harness_shift_left: (count, bits) => exports.harness_shift_left(count, bits) >>> 0,
  harness_shift_right: (count, bits) => exports.harness_shift_right(count, bits) >>> 0,
  harness_divide: (dividendCount, divisorCount) => exports.harness_divide(dividendCount, divisorCount) >>> 0,
  harness_power_mod: (baseCount, exponentCount, modulusCount) =>
    exports.harness_power_mod(baseCount, exponentCount, modulusCount) >>> 0,
  memory: exports.memory,
};

const FAILED = 0xffffffff; // (size_t)-1 in wasm32, once read as unsigned
const ROUNDS = 3000;
const MAX_LIMBS = 256; // up to 8,192 bits
const TWO_TO_THE_64 = 1n << 64n;

// ── moving numbers across the Wasm boundary ─────────────────────────────

/**
 * Writes a BigInt as limbs, least significant first. Returns the limb count.
 * Sometimes adds leading zero limbs, as a fixed-size buffer would: the C code
 * must accept them and normalize.
 */
function writeLimbs(pointer: number, value: bigint): number {
  const limbs: number[] = [];
  for (let rest = value; rest > 0n; rest >>= 32n) limbs.push(Number(rest & 0xffffffffn));
  const paddingLimbs = Number(randomUint32() % 3n);
  for (let padding = 0; padding < paddingLimbs; padding++) limbs.push(0);
  new Uint32Array(harness.memory.buffer, pointer, limbs.length).set(limbs); // fresh view each time
  return limbs.length;
}

/**
 * Rebuilds a BigInt from limbs, most significant first: result = (result << 32n) | limb.
 * Also checks the result is normalized (no leading zero limb), which comparisons rely on.
 */
function readLimbs(pointer: number, limbCount: number): bigint {
  const limbs = new Uint32Array(harness.memory.buffer, pointer, limbCount); // fresh view each time
  assert.ok(limbCount === 0 || limbs[limbCount - 1] !== 0, "result has a leading zero limb (not normalized)");
  let result = 0n;
  for (let index = limbCount - 1; index >= 0; index--) result = (result << 32n) | BigInt(limbs[index]);
  return result;
}

// ── reference helpers ─────────────────────────────────────────────────────

/** floor(√value), by Newton's method, entirely in BigInt. */
function floorSquareRoot(value: bigint): bigint {
  if (value < 2n) return value;
  let estimate = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const better = (estimate + value / estimate) >> 1n;
    if (better >= estimate) return estimate;
    estimate = better;
  }
}

/** base^exponent mod modulus, by binary exponentiation in BigInt. */
function powerMod(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n % modulus;
  base %= modulus;
  for (let rest = exponent; rest > 0n; rest >>= 1n) {
    if (rest & 1n) result = (result * base) % modulus;
    base = (base * base) % modulus;
  }
  return result;
}

// ── random values (fixed seed, so failures reproduce) ────────────────────

let randomState = 0x2f6b_1d3an;
function randomUint32(): bigint {
  // xorshift32
  randomState ^= (randomState << 13n) & 0xffffffffn;
  randomState ^= randomState >> 17n;
  randomState ^= (randomState << 5n) & 0xffffffffn;
  return randomState;
}

/** A random value with a random limb count up to maxLimbs, often with runs of all-ones or zeros. */
function randomBig(maxLimbs = MAX_LIMBS): bigint {
  const limbCount = Number(randomUint32() % BigInt(maxLimbs + 1));
  const pattern = randomUint32() % 6n;
  let value = 0n;
  for (let index = 0; index < limbCount; index++) {
    const limb = pattern === 0n ? 0xffffffffn : pattern === 1n && index < limbCount - 1 ? 0n : randomUint32();
    value = (value << 32n) | limb;
  }
  return value;
}

function randomSmall(): bigint {
  switch (randomUint32() % 4n) {
    case 0n: return randomUint32() % 1000n;
    case 1n: return randomUint32();
    case 2n: return TWO_TO_THE_64 - 1n - (randomUint32() % 3n);
    default: return (randomUint32() << 32n) | randomUint32();
  }
}

// ── tests ─────────────────────────────────────────────────────────────────

describe("bignum.c against BigInt, up to 8,192 bits", () => {
  it("round-trips limbs and agrees on bit length", () => {
    for (let round = 0; round < ROUNDS; round++) {
      const value = randomBig();
      const count = writeLimbs(harness.harness_first_input(), value);
      assert.equal(harness.harness_bit_length(count), value === 0n ? 0 : value.toString(2).length);
      const resultCount = harness.harness_add_small(count, 0n);
      assert.equal(readLimbs(harness.harness_output(), resultCount), value);
    }
  });

  it("compares", () => {
    for (let round = 0; round < ROUNDS; round++) {
      const first = randomBig();
      const second = round % 3 === 0 ? first : randomBig();
      const firstCount = writeLimbs(harness.harness_first_input(), first);
      const secondCount = writeLimbs(harness.harness_second_input(), second);
      const expected = first < second ? -1 : first > second ? 1 : 0;
      assert.equal(harness.harness_compare(firstCount, secondCount), expected, `${first} vs ${second}`);
    }
  });

  it("adds a small value", () => {
    for (let round = 0; round < ROUNDS; round++) {
      const value = randomBig();
      const small = randomSmall();
      const count = writeLimbs(harness.harness_first_input(), value);
      const resultCount = harness.harness_add_small(count, small);
      assert.equal(readLimbs(harness.harness_output(), resultCount), value + small);
    }
  });

  it("subtracts a small value, and refuses to go below zero", () => {
    for (let round = 0; round < ROUNDS; round++) {
      const value = randomBig(round % 4 === 0 ? 3 : MAX_LIMBS); // small values too, to reach zero
      const small = round % 5 === 0 ? value & (TWO_TO_THE_64 - 1n) : randomSmall();
      const count = writeLimbs(harness.harness_first_input(), value);
      const resultCount = harness.harness_subtract_small(count, small);
      if (value >= small) {
        assert.notEqual(resultCount, FAILED);
        assert.equal(readLimbs(harness.harness_output(), resultCount), value - small);
      } else {
        assert.equal(resultCount, FAILED);
      }
    }
  });

  it("finds the remainder modulo a 64-bit divisor", () => {
    for (let round = 0; round < ROUNDS; round++) {
      const value = randomBig();
      const divisor = randomSmall() || 1n;
      const count = writeLimbs(harness.harness_first_input(), value);
      assert.equal(harness.harness_mod_small(count, divisor), value % divisor, `${value} mod ${divisor}`);
    }
  });

  it("takes a square root that never rounds down and stays close", () => {
    for (let round = 0; round < ROUNDS; round++) {
      const value = randomBig();
      const count = writeLimbs(harness.harness_first_input(), value);
      const root = readLimbs(harness.harness_output(), harness.harness_square_root_upper(count));
      const floorRoot = floorSquareRoot(value);
      assert.ok(root >= floorRoot, `√${value}: ${root} is below ${floorRoot}`);
      assert.ok(root <= floorRoot + (floorRoot >> 28n) + 2n, `√${value}: ${root} is too far above ${floorRoot}`);
      if (value < TWO_TO_THE_64) assert.equal(root, floorRoot, "exact below 2^64");
    }
  });

  it("handles limb-count changes at 2^32, 2^64, 2^96 and far beyond", () => {
    for (const bits of [32n, 64n, 96n, 128n, 1024n, 4096n]) {
      const power = 1n << bits;
      for (const value of [power - 1n, power, power + 1n]) {
        const count = writeLimbs(harness.harness_first_input(), value);
        assert.equal(readLimbs(harness.harness_output(), harness.harness_add_small(count, 1n)), value + 1n);
        assert.equal(readLimbs(harness.harness_output(), harness.harness_subtract_small(count, 1n)), value - 1n);
        assert.equal(harness.harness_mod_small(count, 0xfffffffbn), value % 0xfffffffbn);
      }
    }
  });
});

// ── general arithmetic (Phase 4) ──────────────────────────────────────────

/** Writes two numbers into the first and second inputs. Returns their limb counts. */
function writePair(first: bigint, second: bigint): [number, number] {
  return [writeLimbs(harness.harness_first_input(), first), writeLimbs(harness.harness_second_input(), second)];
}

/** Divides with the harness, checking quotient and remainder against BigInt. */
function expectDivision(dividend: bigint, divisor: bigint) {
  const quotientCount = harness.harness_divide(...writePair(dividend, divisor));
  const context = `${dividend} / ${divisor}`;
  assert.notEqual(quotientCount, FAILED, context);
  assert.equal(readLimbs(harness.harness_output(), quotientCount), dividend / divisor, `quotient of ${context}`);
  const remainderCount = harness.harness_second_output_count();
  assert.equal(readLimbs(harness.harness_second_output(), remainderCount), dividend % divisor, `remainder of ${context}`);
}

/** Raises to a power with the harness (Montgomery), checking against BigInt. */
function expectPowerMod(base: bigint, exponent: bigint, modulus: bigint) {
  const baseCount = writeLimbs(harness.harness_first_input(), base);
  const exponentCount = writeLimbs(harness.harness_second_input(), exponent);
  const modulusCount = writeLimbs(harness.harness_third_input(), modulus);
  const resultCount = harness.harness_power_mod(baseCount, exponentCount, modulusCount);
  assert.notEqual(resultCount, FAILED, `modulus ${modulus}`);
  assert.equal(readLimbs(harness.harness_output(), resultCount), powerMod(base, exponent, modulus), `${base}^${exponent} mod ${modulus}`);
}

/** A random odd number above 1 with up to maxLimbs limbs. */
function randomOddModulus(maxLimbs: number): bigint {
  const modulus = randomBig(maxLimbs) | 1n;
  return modulus > 1n ? modulus : 3n;
}

describe("bignum.c general arithmetic against BigInt, up to 8,192 bits", () => {
  it("adds", () => {
    for (let round = 0; round < ROUNDS; round++) {
      const [first, second] = [randomBig(), randomBig()];
      assert.equal(readLimbs(harness.harness_output(), harness.harness_add(...writePair(first, second))), first + second);
    }
  });

  it("subtracts, and refuses to go below zero", () => {
    for (let round = 0; round < ROUNDS; round++) {
      const first = randomBig();
      const second = round % 3 === 0 ? first - (randomBig(4) % (first + 1n)) : randomBig();
      const resultCount = harness.harness_subtract(...writePair(first, second));
      if (first >= second) assert.equal(readLimbs(harness.harness_output(), resultCount), first - second);
      else assert.equal(resultCount, FAILED, `${first} − ${second}`);
    }
  });

  it("multiplies", () => {
    for (let round = 0; round < ROUNDS; round++) {
      const [first, second] = [randomBig(), randomBig()];
      assert.equal(readLimbs(harness.harness_output(), harness.harness_multiply(...writePair(first, second))), first * second);
    }
  });

  it("shifts left and right by any number of bits", () => {
    for (let round = 0; round < ROUNDS; round++) {
      const value = randomBig();
      const bits = Number(randomUint32() % 9000n);
      const count = writeLimbs(harness.harness_first_input(), value);
      assert.equal(readLimbs(harness.harness_output(), harness.harness_shift_left(count, bits)), value << BigInt(bits));
      const countAgain = writeLimbs(harness.harness_first_input(), value);
      assert.equal(readLimbs(harness.harness_output(), harness.harness_shift_right(countAgain, bits)), value >> BigInt(bits));
    }
  });

  it("divides with remainder, and refuses a zero divisor", () => {
    for (let round = 0; round < ROUNDS; round++) {
      const divisor = randomBig(round % 2 === 0 ? 8 : MAX_LIMBS);
      const dividend = round % 4 === 0 ? divisor * randomBig(8) + (randomBig(8) % (divisor || 1n)) : randomBig();
      if (divisor === 0n) assert.equal(harness.harness_divide(...writePair(dividend, divisor)), FAILED);
      else expectDivision(dividend, divisor);
    }
  });

  it("divides where Algorithm D's guesses are hardest", () => {
    const limb = 0xffffffffn;
    for (let round = 0; round < 500; round++) {
      // A divisor whose top limb has its top bit set (no normalizing shift)
      // or is 1 (the largest shift), and a quotient of all-ones limbs, so the
      // quotient-limb guesses sit at their limits.
      const divisorLimbs = 2 + Number(randomUint32() % 6n);
      const topLimb = round % 2 === 0 ? 0x80000000n | (randomUint32() & 0x7fffffffn) : 1n;
      let divisor = topLimb;
      for (let index = 1; index < divisorLimbs; index++) divisor = (divisor << 32n) | (round % 3 === 0 ? limb : randomUint32());
      const quotientLimbs = 1 + Number(randomUint32() % 5n);
      const quotient = (1n << BigInt(32 * quotientLimbs)) - 1n;
      expectDivision(quotient * divisor, divisor);
      expectDivision(quotient * divisor + divisor - 1n, divisor);
      expectDivision(quotient * divisor - 1n, divisor);
    }
    // Hacker's Delight's example of the rare "add back" step
    expectDivision(0x7fffffff_80000000_00000000_00000000n, 0x80000000_00000000_00000001n);
  });

  it("raises to a power modulo an odd number (Montgomery)", () => {
    for (let round = 0; round < 300; round++) {
      const modulus = randomOddModulus(round % 3 === 0 ? 2 : 24);
      expectPowerMod(randomBig(32), randomBig(round % 2 === 0 ? 2 : 24), modulus);
    }
    // Moduli just below and above limb-count changes, and exponents 0 and 1
    for (const bits of [32n, 64n, 96n, 128n, 1024n]) {
      for (const modulus of [(1n << bits) - 1n, (1n << bits) + 1n]) {
        expectPowerMod(12345678901234567890n, 0n, modulus);
        expectPowerMod(12345678901234567890n, 1n, modulus);
        expectPowerMod(modulus - 1n, 2n, modulus); // (−1)² = 1
        expectPowerMod(randomBig(40), randomBig(4), modulus);
      }
    }
  });

  it("refuses an even modulus or one below 2", () => {
    for (const modulus of [0n, 1n, 2n, 1n << 64n, (1n << 200n) + 2n]) {
      const baseCount = writeLimbs(harness.harness_first_input(), 5n);
      const exponentCount = writeLimbs(harness.harness_second_input(), 3n);
      const modulusCount = writeLimbs(harness.harness_third_input(), modulus);
      assert.equal(harness.harness_power_mod(baseCount, exponentCount, modulusCount), FAILED, `modulus ${modulus}`);
    }
  });

  it("works at 1,000 limbs (32,000 bits)", () => {
    for (let round = 0; round < 3; round++) {
      const first = randomBig(1000) | (1n << 31_999n);
      const second = randomBig(1000) | (1n << 31_999n);
      assert.equal(readLimbs(harness.harness_output(), harness.harness_multiply(...writePair(first, second))), first * second);
      expectDivision(first * second + (first >> 1n), second);
      expectPowerMod(randomBig(1000), randomBig(2), second | 1n);
    }
  });
});
