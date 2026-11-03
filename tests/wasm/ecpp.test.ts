// wasm/ecpp.c at large sizes, against the certificate checker's own arithmetic
// (lib/primes/primalityCertificate.ts), which shares no code with it, and the
// test certificate builder's. The module is the harness built by \`npm run test:wasm\`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { addPoints } from "../../lib/primes/primalityCertificate.ts";
import { certifiedPrimeFrom, scalePoint } from "../support/curveCertificates.ts";

interface Harness {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  harness_first_input(): number;
  harness_second_input(): number;
  harness_third_input(): number;
  harness_fourth_input(): number;
  harness_fifth_input(): number;
  harness_output(): number;
  harness_second_output(): number;
  harness_first_output_count(): number;
  harness_second_output_count(): number;
  harness_curve_b(b: number): void;
  harness_curve_multiply(modulus: number, a: number, x: number, y: number, scalar: number): number;
  harness_curve_find_point(modulus: number, a: number, start: number): number;
}

const { instance } = await WebAssembly.instantiate(readFileSync(".cache/bignum_harness.wasm"), {
  env: { emscripten_notify_memory_growth: () => {} },
});
const harness = instance.exports as unknown as Harness;
harness._initialize?.();

// ecpp_status in wasm/ecpp.h, in order.
const FOUND = 0;
const IDENTITY = 1;

function write(pointer: number, value: bigint): number {
  const limbs: number[] = [];
  for (let rest = value; rest > 0n; rest >>= 32n) limbs.push(Number(rest & 0xffffffffn));
  new Uint32Array(harness.memory.buffer, pointer >>> 0, limbs.length).set(limbs);
  return limbs.length;
}

function read(pointer: number, count: number): bigint {
  const limbs = new Uint32Array(harness.memory.buffer, pointer >>> 0, count);
  let result = 0n;
  for (let index = count - 1; index >= 0; index--) result = (result << 32n) | BigInt(limbs[index]);
  return result;
}

function multiply(n: bigint, a: bigint, b: bigint, point: { x: bigint; y: bigint }, scalar: bigint) {
  harness.harness_curve_b(Number(b));
  const status = harness.harness_curve_multiply(
    write(harness.harness_first_input(), n),
    write(harness.harness_second_input(), a),
    write(harness.harness_third_input(), point.x),
    write(harness.harness_fourth_input(), point.y),
    write(harness.harness_fifth_input(), scalar),
  );
  return {
    status,
    x: read(harness.harness_output(), harness.harness_first_output_count() >>> 0),
    y: read(harness.harness_second_output(), harness.harness_second_output_count() >>> 0),
  };
}

function findPoint(n: bigint, a: bigint, b: bigint, start: bigint) {
  harness.harness_curve_b(Number(b));
  const status = harness.harness_curve_find_point(
    write(harness.harness_first_input(), n),
    write(harness.harness_second_input(), a),
    write(harness.harness_third_input(), start),
  );
  return {
    status,
    x: read(harness.harness_output(), harness.harness_first_output_count() >>> 0),
    y: read(harness.harness_second_output(), harness.harness_second_output_count() >>> 0),
  };
}

const PRIMES = [2n ** 89n - 1n, 2n ** 127n - 1n, 10n ** 100n + 267n, 2n ** 521n - 1n, 2n ** 1279n - 1n];

describe("ecpp.c at large sizes", () => {
  it("multiplies as the checker's arithmetic does, step by step", () => {
    for (const n of PRIMES) {
      for (const [a, b] of [[2n, 3n], [n - 3n, 7n], [0n, 5n]] as const) {
        const start = findPoint(n, a, b, 12345n);
        assert.equal(start.status, FOUND, `a point on a curve mod ${n}`);
        assert.equal((start.y * start.y - (start.x ** 3n + a * start.x + b)) % n, 0n, "it's on the curve");
        const base = { x: start.x, y: start.y };
        let running = base;
        for (let multiple = 2n; multiple <= 40n; multiple++) {
          const next = addPoints(running, base, a, n);
          assert.equal(typeof next, "object", "no accidental identity this early");
          if (typeof next === "string") return;
          running = next;
          const result = multiply(n, a, b, base, multiple);
          assert.equal(result.status, FOUND);
          assert.deepEqual({ x: result.x, y: result.y }, running, `${multiple}·P mod ${n}`);
        }
      }
    }
  });

  it("multiplies by huge scalars as the builder's arithmetic does", () => {
    for (const n of PRIMES) {
      const a = 2n;
      const b = 3n;
      const start = findPoint(n, a, b, 99n);
      const base = { x: start.x, y: start.y };
      for (const scalar of [n, n - 1n, 2n ** 200n + 12345n, (n * 3n) / 7n]) {
        const expected = scalePoint(scalar, base, a, n);
        const result = multiply(n, a, b, base, scalar);
        if (expected === null) assert.equal(result.status, IDENTITY);
        else assert.deepEqual({ x: result.x, y: result.y }, expected, `${scalar}·P mod ${n}`);
      }
    }
  });

  it("reaches the identity at a real point's order, on the steps of real certificates", () => {
    const { steps } = certifiedPrimeFrom(10n ** 100n);
    for (const step of steps) {
      const point = { x: step.pointX, y: step.pointY };
      assert.equal(multiply(step.number, step.curveA, step.curveB, point, step.orderPrime).status, IDENTITY);
      assert.equal(multiply(step.number, step.curveA, step.curveB, point, step.orderPrime - 1n).status, FOUND);
      assert.equal(multiply(step.number, step.curveA, step.curveB, point, step.orderPrime + 1n).status, FOUND);
    }
  });
});
