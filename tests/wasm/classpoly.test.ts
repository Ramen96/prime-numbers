// wasm/classpoly.c in 32-bit Wasm, against published polynomials and, in BigInt with
// no shared code, against how H_D must factor mod primes. The module is the harness
// built by `npm run test:wasm`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

interface Harness {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  harness_output(): number;
  harness_class_polynomial(discriminant: number): number;
  harness_class_coefficient(index: number): number;
  harness_class_coefficient_is_negative(index: number): number;
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
    for (const [discriminant, degree] of [[-71, 7], [-199, 9], [-1555, 4], [-15667, 11]] as const) {
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
