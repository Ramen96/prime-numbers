import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NUMBER_CHECK_VERDICT } from "../primeCheck.ts";
import { NumberCheck, settleNumber, type RawNumberCheckExports } from "./numberCheck.ts";

/**
 * A stand-in for the Wasm exports that answers every check with `verdict` and
 * `evidence`, and records the numbers it was asked about (rebuilt from the limbs written).
 */
function engineSaying(verdict: number, evidence = 0, { bufferFails = false } = {}) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const asked: bigint[] = [];
  const raw: RawNumberCheckExports = {
    memory,
    number_check_input_buffer: () => (bufferFails ? 0 : 64),
    check_number: (limbCount) => {
      const limbs = new Uint32Array(memory.buffer, 64, limbCount);
      asked.push(limbs.reduceRight((value, limb) => (value << 32n) | BigInt(limb), 0n));
      return verdict;
    },
    number_check_evidence: () => evidence,
  };
  return { engine: new NumberCheck(raw), asked };
}

const { prime, compositeByWitness, beyondProvenBound, probablePrime, compositeByLucas } = NUMBER_CHECK_VERDICT;

describe("settleNumber", () => {
  it("finds a small factor itself, without asking the engine", () => {
    const { engine, asked } = engineSaying(prime);
    assert.deepEqual(settleNumber(1_000_001n, engine), {
      settled: true,
      answer: { kind: "composite", value: 1_000_001n, evidence: { by: "factor", factor: 101n } },
    });
    assert.deepEqual(asked, []);
  });

  it("passes the engine the number's limbs, and takes its answer once it holds", () => {
    const big = 2n ** 89n - 1n;
    const { engine, asked } = engineSaying(probablePrime);
    assert.deepEqual(settleNumber(big, engine), { settled: true, answer: { kind: "probably-prime", value: big } });
    assert.deepEqual(asked, [big]);
    assert.deepEqual(settleNumber(1_000_003n, engineSaying(prime).engine), {
      settled: true,
      answer: { kind: "prime", value: 1_000_003n, proof: { by: "trial-division" } },
    });
  });

  it("catches an engine that's wrong, and shows nothing it said", () => {
    const semiprime = 65_537n * 65_539n; // no factor below 65,536
    const disputed = (value: bigint, verdict: number, evidence = 0) => {
      const result = settleNumber(value, engineSaying(verdict, evidence).engine);
      assert.equal(result.settled, false, `${value} ${verdict}`);
      return result.settled ? null : result.reason;
    };
    assert.equal(disputed(semiprime, prime), "disputed", "a composite called prime");
    assert.equal(disputed(1_000_003n, compositeByWitness, 2), "disputed", "a prime given a false witness");
    assert.equal(disputed(2n ** 89n - 1n, compositeByLucas), "disputed", "a prime said to fail Lucas");
    assert.equal(disputed(semiprime, probablePrime), "disputed", "a probable prime below a(13)");
    assert.equal(disputed(2n ** 89n - 1n, prime), "disputed", "proven prime past a(13) without a certificate");
    assert.equal(disputed(semiprime, beyondProvenBound), "disputed", "a verdict check_number never gives");
    assert.equal(disputed(semiprime, -1), "disputed");
  });

  it("settles nothing when memory runs out, in the engine or for the input", () => {
    const semiprime = 65_537n * 65_539n;
    assert.deepEqual(settleNumber(semiprime, engineSaying(NUMBER_CHECK_VERDICT.outOfMemory).engine), { settled: false, reason: "out-of-memory" });
    assert.deepEqual(settleNumber(semiprime, engineSaying(prime, 0, { bufferFails: true }).engine), { settled: false, reason: "out-of-memory" });
  });
});
