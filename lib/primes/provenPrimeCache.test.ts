import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cachedPrimeBytes, ProvenPrimeCache } from "./provenPrimeCache.ts";

describe("ProvenPrimeCache", () => {
  const prime = (index: number) => 10n ** 30n + BigInt(index);
  const costOfOne = cachedPrimeBytes(prime(0));

  it("keeps what's added", () => {
    const cache = new ProvenPrimeCache();
    cache.add(prime(1));
    assert.equal(cache.has(prime(1)), true);
    assert.equal(cache.has(prime(2)), false);
  });

  it("drops the oldest first when it's over its cap, and never goes over", () => {
    const cache = new ProvenPrimeCache(3 * costOfOne);
    for (let index = 1; index <= 5; index++) cache.add(prime(index));
    assert.deepEqual([1, 2, 3, 4, 5].map((index) => cache.has(prime(index))), [false, false, true, true, true]);
    assert.equal(cache.size, 3);
    assert.ok(cache.bytes <= 3 * costOfOne);
  });

  it("counts adding a prime again as new, without counting it twice", () => {
    const cache = new ProvenPrimeCache(3 * costOfOne);
    for (let index = 1; index <= 3; index++) cache.add(prime(index));
    cache.add(prime(1)); // now the newest
    cache.add(prime(4)); // so 2 goes, not 1
    assert.deepEqual([1, 2, 3, 4].map((index) => cache.has(prime(index))), [true, false, true, true]);
    assert.equal(cache.bytes, 3 * costOfOne);
  });

  it("keeps nothing that alone is over its cap", () => {
    const cache = new ProvenPrimeCache(costOfOne - 1);
    cache.add(prime(1));
    assert.equal(cache.size, 0);
    assert.equal(cache.bytes, 0);
  });

  it("costs more for longer primes", () => {
    assert.ok(cachedPrimeBytes(10n ** 1000n) > cachedPrimeBytes(10n ** 30n));
  });
});
