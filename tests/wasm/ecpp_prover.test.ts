// wasm/ecpp_prover.c in 32-bit Wasm: every certificate it produces is judged by
// the independent checker (lib/primes/primalityCertificate.ts), which shares no
// code with it. The module is the harness built by `npm run test:wasm`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { checkCertificate, type CertificateStep } from "../../lib/primes/primalityCertificate.ts";
import { nextPrimeAfter } from "../support/primality.ts";

interface Harness {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  harness_first_input(): number;
  harness_output(): number;
  harness_prove(n: number, effortLimit: number): number;
  harness_proof_value(step: number, field: number): number;
}

const { instance } = await WebAssembly.instantiate(readFileSync(".cache/bignum_harness.wasm"), {
  env: { emscripten_notify_memory_growth: () => {} },
});
const harness = instance.exports as unknown as Harness;
harness._initialize?.();

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

/** The prover's certificate for n, read out of Wasm memory. */
function prove(n: bigint, effortLimit = 0): CertificateStep[] {
  const count = harness.harness_prove(write(harness.harness_first_input(), n), effortLimit) >>> 0;
  assert.notEqual(count, 0xffffffff, `memory ran out proving ${n}`);
  return Array.from({ length: count }, (_, step) => {
    const value = (field: number) => read(harness.harness_output(), harness.harness_proof_value(step, field) >>> 0);
    return { number: value(0), curveA: value(1), curveB: value(2), pointX: value(3), pointY: value(4), orderPrime: value(5) };
  });
}

describe("ecpp_prover.c, judged by the independent checker", () => {
  it("proves primes from 26 to 80 digits", () => {
    for (let digits = 26n; digits <= 80n; digits += 6n) {
      let n = 3n * 10n ** (digits - 1n);
      for (let prime = 0; prime < 4; prime++) {
        n = nextPrimeAfter(n + 10n ** (digits / 2n));
        const steps = prove(n);
        assert.ok(steps.length > 0);
        assert.deepEqual(checkCertificate(n, steps), { valid: true }, `${digits} digits: ${n}`);
      }
    }
  });

  it("proves known primes: 2^127 − 1, 10^100 + 267, 2^521 − 1", () => {
    for (const n of [2n ** 127n - 1n, 10n ** 100n + 267n, 2n ** 521n - 1n]) {
      assert.deepEqual(checkCertificate(n, prove(n)), { valid: true }, String(n));
    }
  });

  it("still finishes when a step may examine only 1 discriminant at first (backing up, doubling)", () => {
    const n = nextPrimeAfter(10n ** 40n);
    assert.deepEqual(checkCertificate(n, prove(n, 1)), { valid: true });
  });

  it("the checker refuses its certificate for the wrong number", () => {
    const n = nextPrimeAfter(10n ** 30n);
    const steps = prove(n);
    assert.equal(checkCertificate(nextPrimeAfter(n), steps).valid, false);
  });
});
