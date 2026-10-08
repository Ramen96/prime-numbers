import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  basePrimeBudgetWithin,
  basePrimeMemoryBudget,
  basePrimesCouldFit,
  estimatedBasePrimeBytes,
  fewestBasePrimeBytes,
  LARGEST_BASE_PRIME_BUDGET_BYTES,
  moduleMemoryBudget,
  sharedMemoryMaximumsToTry,
  WASM_PAGE_BYTES,
  shouldRestartWorkerToReleaseMemory,
} from "./memoryBudget.ts";
import { basePrimeLimitNeededFor } from "./wasmSieve.ts";

const GiB = 2 ** 30;
const MiB = 2 ** 20;

// π(10^n), n = 3..19. Source: OEIS A006880, https://oeis.org/A006880/b006880.txt
const PRIMES_BELOW_POWERS_OF_TEN = [
  168n, 1229n, 9592n, 78498n, 664579n, 5761455n, 50847534n, 455052511n, 4118054813n,
  37607912018n, 346065536839n, 3204941750802n, 29844570422669n, 279238341033925n,
  2623557157654233n, 24739954287740860n, 234057667276344607n,
];

/** Bytes sieve.c actually stores for base primes below x: one per odd prime after 3. */
const storedBytes = (primeCount: bigint) => Number(primeCount - 2n);

describe("memory budgets", () => {
  it("are a quarter of the device's memory for the whole module, up to 4 GiB", () => {
    assert.equal(moduleMemoryBudget(0.5), 128 * MiB);
    assert.equal(moduleMemoryBudget(4), 1 * GiB);
    // browsers cap deviceMemory at 8, meaning "8 or more"
    assert.equal(moduleMemoryBudget(8), 2 * GiB);
    assert.equal(moduleMemoryBudget(64), 4 * GiB);
  });

  it("leave base primes all but an allowance for the rest of the module", () => {
    assert.equal(basePrimeMemoryBudget(4), 1 * GiB - 64 * MiB);
    assert.equal(basePrimeMemoryBudget(8), 2 * GiB - 64 * MiB);
    assert.equal(basePrimeMemoryBudget(64), LARGEST_BASE_PRIME_BUDGET_BYTES);
    assert.equal(LARGEST_BASE_PRIME_BUDGET_BYTES, 4 * GiB - 64 * MiB);
    // a small budget keeps at least half for base primes
    assert.equal(basePrimeMemoryBudget(0.25), 32 * MiB);
    assert.equal(basePrimeBudgetWithin(100 * MiB), 50 * MiB);
  });

  it("are null (grow until an allocation fails) when the browser doesn't say", () => {
    assert.equal(moduleMemoryBudget(undefined), null);
    assert.equal(basePrimeMemoryBudget(undefined), null);
    assert.equal(basePrimeMemoryBudget(0), null);
    assert.equal(basePrimeMemoryBudget(Number.NaN), null);
  });

  it("come in whole Wasm pages", () => {
    const budget = moduleMemoryBudget(3.3);
    assert.ok(budget !== null && budget % WASM_PAGE_BYTES === 0);
  });
});

describe("sharedMemoryMaximumsToTry", () => {
  it("tries the budget first, then halves down to 256 MiB", () => {
    assert.deepEqual(sharedMemoryMaximumsToTry(2 * GiB), [2 * GiB, 1 * GiB, 512 * MiB, 256 * MiB]);
  });

  it("tries 4 GiB first when the browser doesn't report its memory (iOS Safari refuses that)", () => {
    assert.deepEqual(sharedMemoryMaximumsToTry(null), [4 * GiB, 2 * GiB, 1 * GiB, 512 * MiB, 256 * MiB]);
  });

  it("tries nothing below 256 MiB, which means the standalone build", () => {
    assert.deepEqual(sharedMemoryMaximumsToTry(128 * MiB), []);
  });

  it("keeps every maximum in whole pages", () => {
    for (const maximum of sharedMemoryMaximumsToTry(1.3 * GiB)) assert.equal(maximum % WASM_PAGE_BYTES, 0);
  });
});

describe("base-prime size bounds against published π(10^n)", () => {
  it("never overestimates the fewest bytes (so nothing that fits is refused)", () => {
    PRIMES_BELOW_POWERS_OF_TEN.forEach((primeCount, index) => {
      const limit = 10n ** BigInt(index + 3);
      const fewest = fewestBasePrimeBytes(limit);
      assert.ok(fewest <= storedBytes(primeCount), `10^${index + 3}: ${fewest} > ${primeCount}`);
      // and stays tight: within 2% from 10^7 on
      if (index + 3 >= 7) assert.ok(fewest > storedBytes(primeCount) * 0.98, `10^${index + 3} too loose`);
    });
  });

  it("reserves at least what's needed, without much overshoot", () => {
    PRIMES_BELOW_POWERS_OF_TEN.forEach((primeCount, index) => {
      const estimate = estimatedBasePrimeBytes(10n ** BigInt(index + 3));
      assert.ok(estimate >= storedBytes(primeCount), `10^${index + 3}: ${estimate} < ${primeCount}`);
      if (index + 3 >= 9) assert.ok(estimate < storedBytes(primeCount) * 1.02, `10^${index + 3} overshoots`);
    });
  });
});

describe("basePrimesCouldFit", () => {
  const limitFor = (from: bigint) => basePrimeLimitNeededFor("next", from, 500);

  it("lets through everything the largest budget can hold", () => {
    assert.equal(basePrimesCouldFit(limitFor(2n ** 63n), null), true); // ~3 × 10^9: ~150 MB
    assert.equal(basePrimesCouldFit(limitFor(2n ** 64n), null), true); // ~4.3 × 10^9: ~200 MB
    assert.equal(basePrimesCouldFit(limitFor(10n ** 21n), null), true); // ~3.2 × 10^10: ~1.4 GB
  });

  it("refuses at once what certainly can't fit", () => {
    assert.equal(basePrimesCouldFit(limitFor(2n ** 96n), null), false); // 2^48: ~9 × 10^12 bytes
    assert.equal(basePrimesCouldFit(basePrimeLimitNeededFor("prev", 2n ** 96n, 500), null), false);
    assert.equal(basePrimesCouldFit(limitFor(10n ** 30n), null), false);
    assert.equal(basePrimesCouldFit(limitFor(10n ** 100n), null), false); // base primes past 2^64
  });

  it("uses the device's budget when there is one", () => {
    const limit = limitFor(10n ** 21n); // needs about 1.4 GB
    assert.equal(basePrimesCouldFit(limit, 2 * GiB), true);
    assert.equal(basePrimesCouldFit(limit, 1 * GiB), false);
  });

  it("refuses exactly where the proven lower bound passes the budget", () => {
    const limit = 10n ** 10n;
    const fewest = fewestBasePrimeBytes(limit);
    assert.equal(basePrimesCouldFit(limit, fewest), true);
    assert.equal(basePrimesCouldFit(limit, fewest - 1), false);
  });
});

describe("shouldRestartWorkerToReleaseMemory", () => {
  it("restarts when a jump needs far less than a large worker holds", () => {
    assert.equal(shouldRestartWorkerToReleaseMemory(1 * GiB, 10 * MiB), true);
    assert.equal(shouldRestartWorkerToReleaseMemory(512 * MiB, 127 * MiB), true);
  });

  it("keeps the worker when the jump needs a good share of its memory", () => {
    assert.equal(shouldRestartWorkerToReleaseMemory(512 * MiB, 128 * MiB), false);
    assert.equal(shouldRestartWorkerToReleaseMemory(1 * GiB, 900 * MiB), false);
  });

  it("keeps a small worker (rebuilding costs more than the memory is worth)", () => {
    assert.equal(shouldRestartWorkerToReleaseMemory(127 * MiB, 1 * MiB), false);
    assert.equal(shouldRestartWorkerToReleaseMemory(128 * MiB, 1 * MiB), true);
    assert.equal(shouldRestartWorkerToReleaseMemory(0, 0), false); // no worker yet
  });
});
