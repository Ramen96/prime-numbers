// The prime checker's verdict (wasm/number_check.c) in both shipped builds,
// judged in BigInt: each verdict becomes an answer (answerFromVerdict), which
// must pass the independent re-check (answerHolds) and agree with the test
// reference (tests/support/primality.ts). Numbers are fed as the worker will:
// only those with no factor below 65,536 (smallestSmallFactor runs first).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { answerFromVerdict, answerHolds, smallestSmallFactor, type PrimeCheckAnswer } from "../../lib/primeCheck.ts";
import { millerRabinVerdict } from "../../lib/primes/verifyPrimes.ts";
import { THREADED_INITIAL_MEMORY_BYTES, type CreateSieveModule } from "../../lib/primes/threadedSieveModule.ts";
import { DETERMINISTIC_BELOW, isPrime, nextPrimeAfter } from "../support/primality.ts";

interface NumberCheckExports {
  inputBuffer(limbCount: number): number;
  check(limbCount: number): number;
  evidence(): number;
  memory(): ArrayBufferLike;
}

/** Writes `value` as limbs (least significant first) and returns check_number's answer. */
function checkIn(engine: NumberCheckExports, value: bigint): ReturnType<typeof answerFromVerdict> {
  const limbs: number[] = [];
  for (let rest = value; rest > 0n; rest >>= 32n) limbs.push(Number(rest & 0xffff_ffffn));
  const pointer = engine.inputBuffer(limbs.length) >>> 0;
  assert.notEqual(pointer, 0);
  new Uint32Array(engine.memory(), pointer, limbs.length).set(limbs);
  const verdict = engine.check(limbs.length);
  return answerFromVerdict(value, verdict, engine.evidence() >>> 0);
}

/** A repeatable pseudo-random number with `digits` digits. */
function randomNumbers(seed: number) {
  let state = seed;
  const nextDigit = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return Math.floor((state / 2_147_483_648) * 10);
  };
  return (digits: number) => {
    let text = String(1 + (nextDigit() % 9));
    while (text.length < digits) text += nextDigit();
    return BigInt(text);
  };
}

/** What the worker will meet: numbers with no small factor, prime and not, at sizes up to 1,000 digits. */
function cases(): bigint[] {
  const random = randomNumbers(2026);
  const found: bigint[] = [0n, 1n, 2n, 3n, 41n, 65_537n, 65_537n * 65_539n, 1_000_003n, 2n ** 61n - 1n];
  found.push(DETERMINISTIC_BELOW - 2n, DETERMINISTIC_BELOW, DETERMINISTIC_BELOW + 2n);
  for (const digits of [10, 20, 25, 26, 30, 60, 100, 300]) {
    const prime = nextPrimeAfter(random(digits));
    found.push(prime, prime * nextPrimeAfter(65_536n + BigInt(digits)), nextPrimeAfter(random(digits / 2)) ** 2n);
  }
  for (const digits of [100, 1000]) for (let sample = 0; sample < 60; sample++) found.push(random(digits) | 1n);
  for (const exponent of [89n, 107n, 127n, 521n, 607n, 1279n]) found.push(2n ** exponent - 1n, 2n ** exponent + 1n);
  return found.filter((value) => smallestSmallFactor(value) === null);
}

function expectAnswersHold(engine: NumberCheckExports) {
  const all = cases();
  assert.ok(all.length > 40, `${all.length} cases`);
  const kinds = new Set<string>();
  for (const value of all) {
    const result = checkIn(engine, value);
    assert.ok(result.settled, `${value}: ${!result.settled && result.reason}`);
    const answer: PrimeCheckAnswer = result.answer;
    kinds.add(answer.kind === "composite" ? answer.evidence.by : answer.kind);
    assert.ok(answerHolds(answer), `${value}: ${JSON.stringify(answer, (_, part) => (typeof part === "bigint" ? String(part) : part))}`);
    if (answer.kind === "prime") assert.equal(millerRabinVerdict(value), "prime", String(value));
    if (answer.kind === "prime" || answer.kind === "probably-prime") assert.equal(isPrime(value), true, String(value));
    else if (answer.kind === "composite") assert.equal(isPrime(value), false, String(value));
    if (value >= DETERMINISTIC_BELOW) assert.notEqual(answer.kind, "prime", "past a(13) nothing is proven here");
  }
  for (const kind of ["neither", "prime", "probably-prime", "witness", "lucas"]) assert.ok(kinds.has(kind), `no ${kind} answer`);
}

describe("check_number in the shipped builds, judged in BigInt", () => {
  it("sieve.wasm", () => {
    const instance = new WebAssembly.Instance(new WebAssembly.Module(readFileSync("public/sieve.wasm")), {
      env: { emscripten_notify_memory_growth: () => {} },
    });
    (instance.exports._initialize as (() => void) | undefined)?.();
    const exports = instance.exports as Record<string, unknown>;
    expectAnswersHold({
      inputBuffer: exports.number_check_input_buffer as (limbCount: number) => number,
      check: exports.check_number as (limbCount: number) => number,
      evidence: exports.number_check_evidence as () => number,
      memory: () => (exports.memory as WebAssembly.Memory).buffer,
    });
  });

  it("the threaded build", async () => {
    const { default: createSieveModule } = (await import(pathToFileURL("public/sieve-threads/sieve.mjs").href)) as {
      default: CreateSieveModule;
    };
    const wasmMemory = new WebAssembly.Memory({
      initial: THREADED_INITIAL_MEMORY_BYTES / 65_536,
      maximum: 2 ** 32 / 65_536,
      shared: true,
    });
    const sieveModule = (await createSieveModule({ wasmMemory, sieveHelperThreads: 2 })) as unknown as Record<string, unknown>;
    expectAnswersHold({
      inputBuffer: sieveModule._number_check_input_buffer as (limbCount: number) => number,
      check: sieveModule._check_number as (limbCount: number) => number,
      evidence: sieveModule._number_check_evidence as () => number,
      memory: () => wasmMemory.buffer,
    });
    (sieveModule as { PThread?: { terminateAllThreads?: () => void } }).PThread?.terminateAllThreads?.();
  });
});
