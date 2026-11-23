// The prime checker's worker logic (lib/primes/primeChecker.ts) on the shipped
// single-threaded build, as its worker runs it: checks, a proof whose
// certificate is checked here again, a pause that keeps the chain for a resume,
// and stand-in provers that are wrong or run out of memory.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { PrimeCheckAnswer } from "../../lib/primeCheck.ts";
import { NumberCheck, type RawNumberCheckExports } from "../../lib/primes/numberCheck.ts";
import { checkCertificate } from "../../lib/primes/primalityCertificate.ts";
import { PrimeChecker, type PrimeCheckEngine, type PrimeCheckResponse } from "../../lib/primes/primeChecker.ts";
import { ProofSlots, type RawProofSlotExports } from "../../lib/primes/proofSlots.ts";
import { nextPrimeAfter } from "../support/primality.ts";

function loadEngine(): PrimeCheckEngine {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(readFileSync("public/sieve.wasm")), {
    env: { emscripten_notify_memory_growth: () => {} },
  });
  (instance.exports._initialize as (() => void) | undefined)?.();
  return {
    numberCheck: new NumberCheck(instance.exports as unknown as RawNumberCheckExports),
    proofSlots: new ProofSlots(instance.exports as unknown as RawProofSlotExports),
  };
}

/** A checker that records what it sends, on a clock that moves 400 ms per reading (so progress is reported). */
function checkerOn(engine: PrimeCheckEngine | Promise<PrimeCheckEngine>, options: { betweenRuns?: () => void; workPerRun?: number } = {}) {
  const sent: PrimeCheckResponse[] = [];
  let clock = 0;
  const checker = new PrimeChecker(Promise.resolve(engine), (response) => sent.push(response), { now: () => (clock += 400), ...options });
  return { checker, sent };
}

const answerOf = (response: PrimeCheckResponse | undefined): PrimeCheckAnswer => {
  assert.equal(response?.type, "answer", JSON.stringify(response, (_, part) => (typeof part === "bigint" ? String(part) : part)));
  return (response as Extract<PrimeCheckResponse, { type: "answer" }>).answer;
};

describe("the prime checker's worker logic, on sieve.wasm", () => {
  const engine = loadEngine();

  it("checks numbers short of a proof", async () => {
    const { checker, sent } = checkerOn(engine);
    await checker.handle({ type: "check", id: 1, value: 1_000_001n });
    await checker.handle({ type: "check", id: 2, value: 2n ** 89n - 1n });
    await checker.handle({ type: "check", id: 3, value: 3_317_044_064_679_887_385_961_981n });
    await checker.handle({ type: "check", id: 4, value: 1_000_003n });
    assert.deepEqual(sent.map((response) => response.id), [1, 2, 3, 4]);
    assert.deepEqual(answerOf(sent[0]), { kind: "composite", value: 1_000_001n, evidence: { by: "factor", factor: 101n } });
    assert.equal(answerOf(sent[1]).kind, "probably-prime");
    assert.deepEqual(answerOf(sent[2]), { kind: "composite", value: 3_317_044_064_679_887_385_961_981n, evidence: { by: "lucas" } });
    assert.equal(answerOf(sent[3]).kind, "prime");
  });

  it("proves a probable prime, reports progress, and sends a certificate that checks", async () => {
    const prime = nextPrimeAfter(10n ** 79n);
    const { checker, sent } = checkerOn(engine, { workPerRun: 8 });
    await checker.handle({ type: "prove", id: 1, value: prime });
    const answer = answerOf(sent.at(-1));
    assert.ok(answer.kind === "prime" && answer.proof.by === "certificate");
    assert.deepEqual(checkCertificate(prime, answer.proof.steps), { valid: true });
    const progress = sent.filter((response) => response.type === "proving-progress");
    assert.ok(progress.length > 0, "progress reported");
    for (const report of progress) assert.ok(report.digits === 80 && report.reachedDigits <= 80 && report.reachedDigits > 0);
  });

  it("pauses a proof, keeping its chain, and resumes it with the time so far", async () => {
    const prime = nextPrimeAfter(10n ** 89n);
    let runs = 0;
    const { checker, sent } = checkerOn(engine, {
      workPerRun: 2,
      betweenRuns: () => {
        if (++runs === 5) void checker.handle({ type: "pause", id: 1 });
      },
    });
    await checker.handle({ type: "prove", id: 1, value: prime });
    assert.deepEqual(sent.at(-1), { type: "paused", id: 1 });
    const pausedProgress = sent.filter((response) => response.type === "proving-progress").at(-1);
    await checker.handle({ type: "prove", id: 2, value: prime });
    const resumed = sent.at(-1) as Extract<PrimeCheckResponse, { type: "answer" }>;
    const answer = answerOf(resumed);
    assert.ok(answer.kind === "prime" && answer.proof.by === "certificate");
    assert.deepEqual(checkCertificate(prime, answer.proof.steps), { valid: true });
    assert.ok(resumed.elapsedMs > (pausedProgress?.elapsedMs ?? 0), "the time before the pause counts");
    assert.ok(runs > 5, "it went on after the pause");
  });

  it("answers a prove of a number that needs no proof without proving it", async () => {
    const { checker, sent } = checkerOn(engine);
    await checker.handle({ type: "prove", id: 1, value: (2n ** 89n - 1n) * (2n ** 61n - 1n) });
    await checker.handle({ type: "prove", id: 2, value: 1_000_003n });
    assert.equal(answerOf(sent[0]).kind, "composite");
    assert.equal(answerOf(sent[1]).kind, "prime");
    assert.equal(sent.length, 2);
  });

  it("stops at a certificate that doesn't hold, and at running out of memory", async () => {
    const prime = nextPrimeAfter(10n ** 40n);
    const { checker: real, sent: realSent } = checkerOn(engine);
    await real.handle({ type: "prove", id: 1, value: prime });
    const good = answerOf(realSent.at(-1));
    assert.ok(good.kind === "prime" && good.proof.by === "certificate");
    const tampered = good.proof.steps.map((step, index) => (index === 0 ? { ...step, pointY: step.pointY + 1n } : step));

    const proverSaying = (result: Awaited<ReturnType<ProofSlots["proveInOrder"]>>) =>
      ({ numberCheck: engine.numberCheck, proofSlots: { proveInOrder: async () => result } as unknown as ProofSlots }) satisfies PrimeCheckEngine;
    const { checker: wrong, sent: wrongSent } = checkerOn(proverSaying({ certificates: [tampered], outOfMemory: false, stopped: false }));
    await wrong.handle({ type: "prove", id: 1, value: prime });
    assert.deepEqual(
      wrongSent.map((response) => [response.type, response.type === "disputed" && response.stage]),
      [["disputed", "proof"]],
    );
    const { checker: full, sent: fullSent } = checkerOn(proverSaying({ certificates: [], outOfMemory: true, stopped: false }));
    await full.handle({ type: "prove", id: 1, value: prime });
    assert.deepEqual(fullSent, [{ type: "memory-limit", id: 1 }]);
  });

  it("reports an engine that failed to load to each request", async () => {
    const sent: PrimeCheckResponse[] = [];
    const checker = new PrimeChecker(Promise.reject(new Error("no sieve.wasm")), (response) => sent.push(response));
    await checker.handle({ type: "check", id: 1, value: 7n });
    await checker.handle({ type: "check", id: 2, value: 9n });
    assert.deepEqual(sent, [
      { type: "error", id: 1, message: "no sieve.wasm" },
      { type: "error", id: 2, message: "no sieve.wasm" },
    ]);
  });
});
