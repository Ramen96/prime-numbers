import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeBatch, type Sieve } from "./computeBatch.ts";
import { fewestBasePrimeBytes } from "./memoryBudget.ts";
import type { BatchRequest, WorkerResponse } from "./protocol.ts";
import { basePrimeLimitNeededFor } from "./wasmSieve.ts";

const REQUEST: BatchRequest = { type: "batch", id: 1, generation: 1, direction: "next", from: 1n, count: 5 };

type StandInSieve = Sieve & { reservations: number[] };

/** A stand-in sieve that returns whatever it's told to, right or wrong. */
function standInSieve(
  primes: bigint[],
  options: { basePrimeLimit?: bigint; extends?: boolean } = {},
): StandInSieve {
  const reservations: number[] = [];
  return {
    reservations,
    basePrimeLimit: () => options.basePrimeLimit ?? 10n ** 12n,
    extendBasePrimes: () => options.extends ?? true,
    reserveBasePrimeStorage: (bytes) => (reservations.push(bytes), true),
    basePrimeMemoryBytes: () => 1234,
    moduleMemoryBytes: () => 5678,
    findPrimes: () => ({ primes, reachedMemoryLimit: false }),
  };
}

function run(sieve: Sieve, request = REQUEST, memoryBudgetBytes: number | null = null): WorkerResponse[] {
  const sent: WorkerResponse[] = [];
  computeBatch(sieve, request, (response) => sent.push(response), { memoryBudgetBytes });
  return sent;
}

describe("computeBatch", () => {
  it("sends verified primes with separate sieving, setup and verification times", () => {
    const [response] = run(standInSieve([2n, 3n, 5n, 7n, 11n]));
    assert.equal(response.type, "batch");
    if (response.type !== "batch") return;
    assert.deepEqual(response.primes, [2n, 3n, 5n, 7n, 11n]);
    assert.equal(typeof response.verificationDurationMs, "number");
    assert.deepEqual(response.memory, { basePrimeBytes: 1234, moduleBytes: 5678 });
  });

  it("never sends a batch the verification disagrees with", () => {
    const sent = run(standInSieve([2n, 3n, 5n, 7n, 9n]));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, "error");
    if (sent[0].type === "error") assert.match(sent[0].message, /reported 9 as prime/);
  });

  it("announces base-prime building, then reports the memory limit if it fails", () => {
    const sent = run(standInSieve([], { basePrimeLimit: 0n, extends: false }), { ...REQUEST, from: 2n ** 63n });
    assert.deepEqual(sent.map((response) => response.type), ["building-base-primes", "memory-limit"]);
  });

  it("reports the memory limit at once when base primes can't possibly fit", () => {
    const sieve = standInSieve([]);
    const sent = run(sieve, { ...REQUEST, from: 10n ** 30n });
    assert.deepEqual(sent.map((response) => response.type), ["memory-limit"]);
    assert.deepEqual(sieve.reservations, [], "nothing reserved for a jump that can't fit");
  });

  it("checks against the device's budget, not just the module's address space", () => {
    // near 10^21 the base primes take about 1.4 GB
    const request = { ...REQUEST, from: 10n ** 21n };
    const withRoom = run(standInSieve([], { basePrimeLimit: 0n, extends: false }), request, 2 * 2 ** 30);
    assert.deepEqual(withRoom.map((response) => response.type), ["building-base-primes", "memory-limit"]);
    const withoutRoom = run(standInSieve([], { basePrimeLimit: 0n }), request, 2 ** 30);
    assert.deepEqual(withoutRoom.map((response) => response.type), ["memory-limit"]);
  });

  it("reserves base-prime storage from an estimate before building, within the budget", () => {
    const sieve = standInSieve([9007199254741033n], { basePrimeLimit: 0n });
    run(sieve, { ...REQUEST, from: 2n ** 53n, count: 1 });
    // √(2^53) ≈ 9.5 × 10^7: about 5.5 million base primes
    assert.equal(sieve.reservations.length, 1);
    assert.ok(sieve.reservations[0] > 5_400_000 && sieve.reservations[0] < 5_700_000);

    // a budget between the proven minimum and the estimate: reserve only the budget
    const budget = fewestBasePrimeBytes(basePrimeLimitNeededFor("next", 2n ** 53n, 1));
    assert.ok(budget < sieve.reservations[0]);
    const capped = standInSieve([9007199254741033n], { basePrimeLimit: 0n });
    run(capped, { ...REQUEST, from: 2n ** 53n, count: 1 }, budget);
    assert.deepEqual(capped.reservations, [budget]);
  });

  it("doesn't reserve when the base primes are already there", () => {
    const sieve = standInSieve([2n, 3n, 5n, 7n, 11n]);
    run(sieve);
    assert.deepEqual(sieve.reservations, []);
  });
});
