// wasm/classpoly.c in 32-bit Wasm, against published polynomials and, in BigInt with
// no shared code, against how H_D must factor mod primes. The module is the harness
// built by `npm run test:wasm`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isPrime as isProbablePrime } from "../support/primality.ts";

interface Harness {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  harness_output(): number;
  harness_class_polynomial(discriminant: number): number;
  harness_class_coefficient(index: number): number;
  harness_class_coefficient_is_negative(index: number): number;
  harness_class_root(n: number): number;
  harness_first_input(): number;
  harness_first_output_count(): number;
}

const { instance } = await WebAssembly.instantiate(readFileSync(".cache/bignum_harness.wasm"), {
  env: { emscripten_notify_memory_growth: () => {} },
});
const harness = instance.exports as unknown as Harness;
harness._initialize?.();

/** H_D's coefficients, lowest power first, without the leading 1. */
function classPolynomial(discriminant: number): bigint[] {
  const degree = harness.harness_class_polynomial(discriminant) >>> 0;
  return Array.from({ length: degree }, (_, index) => {
    const count = harness.harness_class_coefficient(index) >>> 0;
    const limbs = new Uint32Array(harness.memory.buffer, harness.harness_output() >>> 0, count);
    let size = 0n;
    for (let limb = count - 1; limb >= 0; limb--) size = (size << 32n) | BigInt(limbs[limb]);
    return harness.harness_class_coefficient_is_negative(index) ? -size : size;
  });
}

/** Whether 4p = t² + |D|v² for some t and v above 0. t = 0 is a prime that divides D, which doesn't split. */
function solvesTheEquation(p: bigint, size: bigint): boolean {
  for (let v = 1n; size * v * v <= 4n * p; v++) {
    const rest = 4n * p - size * v * v;
    let t = 0n;
    while (t * t < rest) t++;
    if (t > 0n && t * t === rest) return true;
  }
  return false;
}

function powerMod(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  base = ((base % modulus) + modulus) % modulus;
  for (; exponent > 0n; exponent >>= 1n) {
    if (exponent & 1n) result = (result * base) % modulus;
    base = (base * base) % modulus;
  }
  return result;
}

function isPrime(value: bigint): boolean {
  if (value < 2n) return false;
  for (let divisor = 2n; divisor * divisor <= value; divisor++) if (value % divisor === 0n) return false;
  return true;
}

describe("classpoly.c in Wasm", () => {
  it("matches published polynomials", () => {
    assert.deepEqual(classPolynomial(-163), [262537412640768000n]);
    assert.deepEqual(classPolynomial(-15), [-121287375n, 191025n]);
    assert.deepEqual(classPolynomial(-23), [12771880859375n, -5151296875n, 3491750n]);
  });

  it("splits completely mod primes p with 4p = t² + |D|v² (t above 0), at degrees up to 11", () => {
    const degrees: [number, number][] = [[-71, 7], [-199, 9], [-1555, 4], [-15667, 11]];
    for (const [discriminant, degree] of degrees) {
      const size = BigInt(-discriminant);
      const coefficients = classPolynomial(discriminant);
      assert.equal(coefficients.length, degree);
      let primesUsed = 0;
      for (let p = size / 4n + 1n; primesUsed < 3; p++) {
        if (!isPrime(p) || !solvesTheEquation(p, size)) continue;
        primesUsed++;
        let roots = 0;
        for (let j = 0n; j < p; j++) {
          let value = 1n;
          for (let index = degree - 1; index >= 0; index--) value = (value * j + coefficients[index]) % p;
          if (value === 0n) roots++;
        }
        assert.equal(roots, degree, `roots mod ${p}, D = ${discriminant}`);
      }
    }
  });

  it("refuses an invalid discriminant", () => {
    assert.equal(harness.harness_class_polynomial(-5) >>> 0, 0xffffffff);
  });
});

function write(pointer: number, value: bigint): number {
  const limbs: number[] = [];
  for (let rest = value; rest > 0n; rest >>= 32n) limbs.push(Number(rest & 0xffffffffn));
  new Uint32Array(harness.memory.buffer, pointer >>> 0, limbs.length).set(limbs);
  return limbs.length;
}

/** A root of the last polynomial built, mod n, or null. */
function rootMod(n: bigint): bigint | null {
  const status = harness.harness_class_root(write(harness.harness_first_input(), n));
  if (status !== 1) return null;
  const count = harness.harness_first_output_count() >>> 0;
  const limbs = new Uint32Array(harness.memory.buffer, harness.harness_output() >>> 0, count);
  let root = 0n;
  for (let limb = count - 1; limb >= 0; limb--) root = (root << 32n) | BigInt(limbs[limb]);
  return root;
}

function evaluateMod(coefficients: bigint[], value: bigint, n: bigint): bigint {
  let sum = 1n;
  for (let index = coefficients.length - 1; index >= 0; index--) sum = (sum * value + coefficients[index]) % n;
  return ((sum % n) + n) % n;
}

describe("classpoly.c roots mod large primes", () => {
  it("finds a root mod primes 4N = t² + |D|v² of 100 to 300 digits (degrees up to 35), checked in BigInt", () => {
    const sizesByDiscriminant: [number, bigint[]][] = [
      [-23, [100n, 300n]],
      [-71, [100n, 300n]],
      [-1555, [100n, 300n]],
      [-15667, [100n, 200n]],
      [-65707, [100n]],
    ];
    for (const [discriminant, sizes] of sizesByDiscriminant) {
      const coefficients = classPolynomial(discriminant);
      for (const digits of sizes) {
        let found = 0;
        // v = 1 gives an even N for some D (|D| ≡ 7 mod 8), so try v = 2 as well
        for (let step = 0n; found < 2; step++) {
          const t = 10n ** (digits / 2n) + step / 2n;
          const v = 1n + (step % 2n);
          const fourN = t * t + BigInt(-discriminant) * v * v;
          if (fourN % 4n !== 0n || (fourN / 4n) % 2n === 0n || !isProbablePrime(fourN / 4n)) continue;
          const n = fourN / 4n;
          found++;
          const root = rootMod(n);
          assert.notEqual(root, null, `a root mod a ${digits}-digit prime, D = ${discriminant}`);
          assert.ok(root! < n);
          assert.equal(evaluateMod(coefficients, root!, n), 0n, `H_D(root) mod a ${digits}-digit prime, D = ${discriminant}`);
        }
      }
    }
  });

  it("gives only real roots mod a prime that D isn't a square of", () => {
    // there H_D can still have roots (with an odd degree it always has one), but
    // ECPP never asks there: only primes that D is a square of have its orders
    const coefficients = classPolynomial(-71);
    let n = 10n ** 100n + 1n;
    while (!isProbablePrime(n) || powerMod(-71n, (n - 1n) / 2n, n) !== n - 1n) n += 2n;
    const root = rootMod(n);
    if (root !== null) assert.equal(evaluateMod(coefficients, root, n), 0n);
  });
});
