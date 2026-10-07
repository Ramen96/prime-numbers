import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  basePrimeLimitNeededFor,
  ceilSquareRoot,
  fromLimbs,
  toLimbs,
  unsigned32,
  unsigned64,
  WasmSieve,
  type RawSieveExports,
} from "./wasmSieve.ts";

const TWO_TO_THE_63 = 2n ** 63n;
const TWO_TO_THE_64 = 2n ** 64n;

/** What Wasm actually hands JavaScript for an unsigned 64-bit value: signed. */
const asWasmReturnsIt64 = (value: bigint) => BigInt.asIntN(64, value);
/** And for an unsigned 32-bit pointer, count or length. */
const asWasmReturnsIt32 = (value: number) => value | 0;

/**
 * Fake sieve exports: a batch of primes `base + offsets`, laid out in a real
 * WebAssembly.Memory the way sieve.c lays it out, with every integer returned
 * signed, exactly as Wasm returns it.
 */
function fakeSieve(base: bigint, offsets: bigint[], basePrimeLimit = 0n): RawSieveExports {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const baseLimbs = toLimbs(base);
  const baseLimbsPointer = 1024;
  const offsetsPointer = 4096;
  const requestPointer = 8192;
  new Uint32Array(memory.buffer, baseLimbsPointer, baseLimbs.length).set(baseLimbs);
  new BigUint64Array(memory.buffer, offsetsPointer, offsets.length).set(offsets);
  return {
    memory,
    request_buffer: () => asWasmReturnsIt32(requestPointer),
    sieve_next: () => asWasmReturnsIt32(offsets.length),
    sieve_prev: () => asWasmReturnsIt32(offsets.length),
    batch_base_limbs: () => asWasmReturnsIt32(baseLimbsPointer),
    batch_base_limb_count: () => asWasmReturnsIt32(baseLimbs.length),
    batch_offset_buffer: () => asWasmReturnsIt32(offsetsPointer),
    batch_reached_memory_limit: () => 0,
    base_prime_limit: () => asWasmReturnsIt64(basePrimeLimit),
    extend_base_primes: () => 1,
    set_base_prime_memory_budget: () => {},
    reserve_base_prime_storage: () => 1,
    // 3 GiB of base primes, possible now the module can grow to 4 GiB: Wasm
    // returns it as a negative i32
    base_prime_memory_bytes: () => asWasmReturnsIt32(3 * 2 ** 30),
  };
}

describe("WasmSieve memory", () => {
  it("reports base-prime memory past 2 GiB as unsigned", () => {
    assert.equal(new WasmSieve(fakeSieve(3n, [0n])).basePrimeMemoryBytes(), 3 * 2 ** 30);
  });

  it("passes budgets and reservations as size_t, capped at 2^32 − 1", () => {
    const passed: number[] = [];
    const exports = {
      ...fakeSieve(3n, [0n]),
      set_base_prime_memory_budget: (bytes: number) => void passed.push(bytes),
      reserve_base_prime_storage: (bytes: number) => (passed.push(bytes), 1),
    };
    const sieve = new WasmSieve(exports);
    sieve.setBasePrimeMemoryBudget(3 * 2 ** 30);
    sieve.setBasePrimeMemoryBudget(2 ** 40);
    assert.equal(sieve.reserveBasePrimeStorage(2 ** 33), true);
    assert.deepEqual(passed, [3 * 2 ** 30, 2 ** 32 - 1, 2 ** 32 - 1]);
  });
});

describe("unsigned64 / unsigned32", () => {
  it("turn Wasm's signed values back into the unsigned values C meant", () => {
    for (const value of [0n, 1n, TWO_TO_THE_63 - 1n, TWO_TO_THE_63, TWO_TO_THE_63 + 1n, TWO_TO_THE_64 - 1n]) {
      assert.equal(unsigned64(asWasmReturnsIt64(value)), value);
    }
    for (const value of [0, 1, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1]) {
      assert.equal(unsigned32(asWasmReturnsIt32(value)), value);
    }
  });
});

describe("WasmSieve", () => {
  it("reads a base-prime limit at and past 2^63 as unsigned", () => {
    for (const limit of [TWO_TO_THE_63 - 1n, TWO_TO_THE_63, TWO_TO_THE_64 - 1n]) {
      assert.equal(new WasmSieve(fakeSieve(2n, [0n], limit)).basePrimeLimit(), limit);
    }
  });

  for (const [description, base] of [
    ["just below 2^63", TWO_TO_THE_63 - 25n],
    ["at 2^63", TWO_TO_THE_63 + 29n],
    ["just below 2^64", TWO_TO_THE_64 - 59n],
    ["past 2^64", TWO_TO_THE_64 + 13n],
    ["far past 2^64", 2n ** 200n + 235n],
  ] as const) {
    it(`rebuilds primes ${description} exactly, and never negative`, () => {
      const offsets = [0n, 6n, 40n, 2n ** 33n];
      const sieve = new WasmSieve(fakeSieve(base, offsets));
      for (const direction of ["next", "prev"] as const) {
        const { primes } = sieve.findPrimes(direction, base, offsets.length);
        assert.deepEqual(primes, offsets.map((offset) => base + offset));
        assert.ok(primes.every((prime) => prime > 0n));
      }
    });
  }
});

describe("limbs", () => {
  it("round-trip any size, least significant limb first", () => {
    for (const value of [0n, 1n, 2n ** 32n - 1n, 2n ** 32n, TWO_TO_THE_63, TWO_TO_THE_64 + 1n, 3n ** 300n]) {
      assert.equal(fromLimbs(toLimbs(value)), value);
    }
    assert.deepEqual(toLimbs(TWO_TO_THE_64 + 5n), [5, 0, 1]);
  });
});

describe("base primes a batch needs", () => {
  it("ceilSquareRoot is exact, at any size", () => {
    for (const root of [1n, 2n, 3037000499n, 2n ** 32n, 10n ** 40n]) {
      assert.equal(ceilSquareRoot(root * root), root);
      assert.equal(ceilSquareRoot(root * root + 1n), root + 1n);
    }
  });

  it("covers √ of where the batch is likely to end", () => {
    const needed = basePrimeLimitNeededFor("next", 10n ** 12n, 500);
    assert.ok(needed * needed >= 10n ** 12n + 65_536n);
    assert.ok(needed < 1_010_000n);
  });
});
