// wasm/ecpp.c at large sizes, against the certificate checker's own arithmetic
// (lib/primes/primalityCertificate.ts), which shares no code with it, and the
// test certificate builder's. The module is the harness built by \`npm run test:wasm\`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { addPoints, orderIsLargeEnough, stepProblem } from "../../lib/primes/primalityCertificate.ts";
import { isPrime, nextPrimeAfter } from "../support/primality.ts";
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
  harness_ecpp_orders(n: number, discriminant: number): number;
  harness_ecpp_order(index: number): number;
  harness_ecpp_curve(n: number, discriminant: number, order: number, q: number): number;
  harness_ecpp_curve_value(index: number): number;
  harness_class_polynomial(discriminant: number): number;
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

// ── curves with a known order ─────────────────────────────────────────────

// Every D of class number 1, then some above 1, up to 11.
const DISCRIMINANTS = [-3, -4, -7, -8, -11, -19, -43, -67, -163, -15, -20, -23, -24, -31, -35, -40, -71, -1555, -15667];
const SMALL_PRIMES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n, 53n, 59n, 61n, 67n, 71n, 73n, 79n, 83n, 89n, 97n];
const NOT_FOUND = 0xffffffff;

function ordersFor(n: bigint, discriminant: number): bigint[] {
  const count = harness.harness_ecpp_orders(write(harness.harness_first_input(), n), discriminant) >>> 0;
  if (count === NOT_FOUND) return [];
  return Array.from({ length: count }, (_, index) => read(harness.harness_output(), harness.harness_ecpp_order(index) >>> 0));
}

function curveFor(n: bigint, discriminant: number, order: bigint, q: bigint) {
  // D = −3 and −4 need no class polynomial; for any other D the curve's j is a root of H_D
  if (discriminant < -4) harness.harness_class_polynomial(discriminant);
  const status = harness.harness_ecpp_curve(
    write(harness.harness_first_input(), n),
    discriminant,
    write(harness.harness_second_input(), order),
    write(harness.harness_third_input(), q),
  );
  if (status !== FOUND) return null;
  const value = (index: number) => read(harness.harness_output(), harness.harness_ecpp_curve_value(index) >>> 0);
  return { number: n, curveA: value(0), curveB: value(1), pointX: value(2), pointY: value(3), orderPrime: q };
}

describe("ecpp.c curves with a known order", () => {
  it("gives orders within Hasse's bound for large primes", () => {
    for (const n of PRIMES) {
      for (const discriminant of DISCRIMINANTS) {
        for (const order of ordersFor(n, discriminant)) {
          const trace = n + 1n - order;
          assert.ok(trace * trace <= 4n * n, `order ${order} of ${n}, D = ${discriminant}`);
        }
      }
    }
  });

  it("builds certificate steps the independent checker accepts, for every prime order it can use", () => {
    let stepsChecked = 0;
    const seenDiscriminants = new Set<number>();
    for (const start of [10n ** 30n, 10n ** 60n, 10n ** 100n]) {
      let n = start;
      for (let prime = 0; prime < 60; prime++) {
        n = nextPrimeAfter(n);
        for (const discriminant of DISCRIMINANTS) {
          for (const order of ordersFor(n, discriminant)) {
            let q = order;
            for (const small of SMALL_PRIMES) while (q % small === 0n) q /= small;
            if (!orderIsLargeEnough(q, n) || !isPrime(q)) continue;
            const step = curveFor(n, discriminant, order, q);
            assert.notEqual(step, null, `a curve for ${n}, D = ${discriminant}, order ${order}`);
            assert.equal(stepProblem(step!), null, `the step for ${n}, D = ${discriminant}, order ${order}`);
            stepsChecked++;
            seenDiscriminants.add(discriminant);
          }
        }
      }
    }
    assert.ok(stepsChecked > 20, `only ${stepsChecked} steps`);
    // a D of class number h has orders for only about 1 in 2h primes, so the larger
    // ones aren't all certain to come up in 180 primes
    for (const discriminant of DISCRIMINANTS.slice(0, 9)) assert.ok(seenDiscriminants.has(discriminant), `D = ${discriminant} was used`);
    const largerUsed = DISCRIMINANTS.slice(9).filter((discriminant) => seenDiscriminants.has(discriminant));
    assert.ok(largerUsed.length >= 6, `only ${largerUsed.join(", ")} of class number above 1 were used`);
  });

  it("reaches every twist for D = −3 and −4, even where small values miss some", () => {
    // mod this prime, no y² = x³ + b with b from 1 to 64 has the first D = −3 order
    // (2, 3 and 11 are sixth powers), so trying small b alone missed it
    const missed = curveFor(700010000000000000000000000017n, -3, 700010000000001518696923673857n, 27928136025116726647n);
    assert.notEqual(missed, null);
    assert.equal(stepProblem(missed!), null);
    // and every usable order of 40 primes, for both families
    for (let n = 10n ** 40n, prime = 0; prime < 40; prime++) {
      n = nextPrimeAfter(n);
      for (const discriminant of [-3, -4]) {
        for (const order of ordersFor(n, discriminant)) {
          let q = order;
          for (const small of SMALL_PRIMES) while (q % small === 0n) q /= small;
          if (!orderIsLargeEnough(q, n) || !isPrime(q)) continue;
          const step = curveFor(n, discriminant, order, q);
          assert.notEqual(step, null, `a curve for ${n}, D = ${discriminant}, order ${order}`);
          assert.equal(stepProblem(step!), null);
        }
      }
    }
  });

  it("finds nothing for a wrong order or a q that doesn't divide it", () => {
    const n = nextPrimeAfter(10n ** 40n);
    const discriminant = DISCRIMINANTS.find((d) => ordersFor(n, d).length > 0)!;
    const [order] = ordersFor(n, discriminant);
    assert.equal(curveFor(n, discriminant, order, order + 2n), null);
    // a prime that's no order of any of these curves: no point can have that order
    const wrongOrder = nextPrimeAfter(order + 1000n);
    assert.equal(curveFor(n, discriminant, wrongOrder, wrongOrder), null);
  });
});
