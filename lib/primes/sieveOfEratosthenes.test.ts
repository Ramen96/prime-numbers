import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { firstPrimes, primalityTableBelow } from "./sieveOfEratosthenes.ts";

describe("firstPrimes", () => {
  it("starts 2, 3, 5, 7, 11", () => {
    assert.deepEqual(firstPrimes(5), [2, 3, 5, 7, 11]);
  });

  it("returns exactly the first 500 primes, ending at 3,571 (the first batch)", () => {
    const primes = firstPrimes(500);
    assert.equal(primes.length, 500);
    assert.equal(primes[499], 3571);
  });

  it("handles tiny counts", () => {
    assert.deepEqual(firstPrimes(0), []);
    assert.deepEqual(firstPrimes(1), [2]);
  });
});

describe("primalityTableBelow", () => {
  it("counts 78,498 primes below 1,000,000", () => {
    const isPrime = primalityTableBelow(1_000_000);
    assert.equal(isPrime.reduce((count, flag) => count + flag, 0), 78_498);
  });
});
