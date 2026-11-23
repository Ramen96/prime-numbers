// The prime checker's verdict (wasm/number_check.c) in both shipped builds,
// through the worker's own adapter (lib/primes/numberCheck.ts): settleNumber
// looks for a factor below 65,536 first, so the C side sees what it will in the
// app, and every answer must pass the independent re-check (answerHolds, inside
// settleNumber) and agree with the test reference (tests/support/primality.ts).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { smallestSmallFactor } from "../../lib/primeCheck.ts";
import { NumberCheck, settleNumber } from "../../lib/primes/numberCheck.ts";
import { millerRabinVerdict } from "../../lib/primes/verifyPrimes.ts";
import {
  rawNumberCheckExportsOf,
  THREADED_INITIAL_MEMORY_BYTES,
  type CreateSieveModule,
  type ThreadedSieveModule,
} from "../../lib/primes/threadedSieveModule.ts";
import { DETERMINISTIC_BELOW, isPrime, nextPrimeAfter } from "../support/primality.ts";

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

/** Numbers prime and not, at sizes up to 1,000 digits; most of those the C side sees have no small factor. */
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
  return found;
}

function expectAnswersHold(engine: NumberCheck) {
  const all = cases();
  const kinds = new Set<string>();
  for (const value of all) {
    const result = settleNumber(value, engine);
    assert.ok(result.settled, `${value}: ${!result.settled && result.reason}`);
    const { answer } = result;
    kinds.add(answer.kind === "composite" ? answer.evidence.by : answer.kind);
    if (answer.kind === "prime") assert.equal(millerRabinVerdict(value), "prime", String(value));
    if (answer.kind === "prime" || answer.kind === "probably-prime") assert.equal(isPrime(value), true, String(value));
    else if (answer.kind === "composite") assert.equal(isPrime(value), false, String(value));
    if (answer.kind === "composite" && answer.evidence.by === "factor")
      assert.equal(answer.evidence.factor, smallestSmallFactor(value), "a small factor is found before the C side is asked");
    if (value >= DETERMINISTIC_BELOW) assert.notEqual(answer.kind, "prime", "past a(13) nothing is proven here");
  }
  assert.ok(all.filter((value) => smallestSmallFactor(value) === null).length > 40, "enough reach the C side");
  for (const kind of ["neither", "prime", "probably-prime", "factor", "witness", "lucas"]) assert.ok(kinds.has(kind), `no ${kind} answer`);
}

describe("check_number in the shipped builds, judged in BigInt", () => {
  it("sieve.wasm", () => {
    const instance = new WebAssembly.Instance(new WebAssembly.Module(readFileSync("public/sieve.wasm")), {
      env: { emscripten_notify_memory_growth: () => {} },
    });
    (instance.exports._initialize as (() => void) | undefined)?.();
    expectAnswersHold(new NumberCheck(instance.exports as unknown as ConstructorParameters<typeof NumberCheck>[0]));
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
    const sieveModule: ThreadedSieveModule = await createSieveModule({ wasmMemory, sieveHelperThreads: 2 });
    expectAnswersHold(new NumberCheck(rawNumberCheckExportsOf(sieveModule)));
  });
});
