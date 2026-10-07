// The boundary between JavaScript and the Wasm sieve (wasm/sieve.c).
//
// Wasm integers reach JavaScript as *signed* values: a uint64_t of 2^63 or
// more arrives as a negative BigInt, and a 32-bit pointer, count or length of
// 2^31 or more as a negative number. This file is the one place where they're
// made unsigned again (unsigned64 / unsigned32), and where primes are rebuilt
// as exact BigInts from limbs and offsets read through Uint32Array and
// BigUint64Array views (unsigned already). No prime ever passes through a JS
// number (CLAUDE.md, Requirement B).

import { naturalLog } from "./logarithmicIntegral.ts";
import type { Direction } from "./protocol.ts";

/** wasm/sieve.c's exports exactly as Emscripten produces them: integers are signed. */
export interface RawSieveExports {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  request_buffer(limbCount: number): number;
  sieve_next(requestLimbCount: number, count: number): number;
  sieve_prev(requestLimbCount: number, count: number): number;
  batch_base_limbs(): number;
  batch_base_limb_count(): number;
  batch_offset_buffer(): number;
  batch_reached_memory_limit(): number;
  base_prime_limit(): bigint;
  extend_base_primes(limit: bigint): number;
  set_base_prime_memory_budget(bytes: number): void;
  reserve_base_prime_storage(bytes: number): number;
  base_prime_memory_bytes(): number;
}

/** A uint64_t returned by a Wasm function, as the unsigned value C meant. */
export function unsigned64(value: bigint): bigint {
  return BigInt.asUintN(64, value);
}

/** A 32-bit pointer, count or length returned by a Wasm function, as unsigned. */
export function unsigned32(value: number): number {
  return value >>> 0;
}

/** Numbers covered by one segment in sieve.c (2 × SEGMENT_BYTES: odd numbers only). */
export const SEGMENT_SPAN = 65_536n;

export interface SieveBatch {
  /** Ascending, exact, any size. */
  primes: bigint[];
  reachedMemoryLimit: boolean;
}

/** Splits a non-negative BigInt into 32-bit limbs, least significant first. */
export function toLimbs(value: bigint): number[] {
  const limbs: number[] = [];
  for (let rest = value; rest > 0n; rest >>= 32n) limbs.push(Number(rest & 0xffff_ffffn));
  return limbs;
}

/** Rebuilds a BigInt from limbs, most significant first: result = (result << 32n) | limb. */
export function fromLimbs(limbs: ArrayLike<number>): bigint {
  let result = 0n;
  for (let index = limbs.length - 1; index >= 0; index--) {
    result = (result << 32n) | BigInt(limbs[index]);
  }
  return result;
}

/** The sieve, with every value converted to unsigned and every prime rebuilt exactly. */
export class WasmSieve {
  readonly #raw: RawSieveExports;

  constructor(raw: RawSieveExports) {
    this.#raw = raw;
  }

  /** Exclusive: every odd prime below this is a base prime already. */
  basePrimeLimit(): bigint {
    return unsigned64(this.#raw.base_prime_limit());
  }

  /** Builds every base prime up to `limit` (below 2^64). False if they don't fit in memory. */
  extendBasePrimes(limit: bigint): boolean {
    return this.#raw.extend_base_primes(limit) !== 0;
  }

  /**
   * Caps the base primes' memory (see memoryBudget.ts). A size_t in wasm32,
   * so at most 2^32 − 1; JavaScript passes it as an i32, which keeps the bits.
   */
  setBasePrimeMemoryBudget(bytes: number): void {
    this.#raw.set_base_prime_memory_budget(Math.min(bytes, 2 ** 32 - 1));
  }

  /** Allocates base-prime storage up front. False if it doesn't fit. */
  reserveBasePrimeStorage(bytes: number): boolean {
    return this.#raw.reserve_base_prime_storage(Math.min(bytes, 2 ** 32 - 1)) !== 0;
  }

  /** Bytes allocated for base primes. */
  basePrimeMemoryBytes(): number {
    return unsigned32(this.#raw.base_prime_memory_bytes());
  }

  /** Everything the module holds. Wasm memory only grows; restarting the worker releases it. */
  moduleMemoryBytes(): number {
    return this.#raw.memory.buffer.byteLength;
  }

  /** Up to `count` primes after (or before) `from`, ascending. */
  findPrimes(direction: Direction, from: bigint, count: number): SieveBatch {
    const raw = this.#raw;
    const requestLimbs = toLimbs(from);
    const requestPointer = unsigned32(raw.request_buffer(requestLimbs.length));
    if (requestLimbs.length > 0 && requestPointer === 0) return { primes: [], reachedMemoryLimit: true };
    // A fresh view after every call: memory growth detaches old ones.
    new Uint32Array(raw.memory.buffer, requestPointer, requestLimbs.length).set(requestLimbs);

    const primeCount = unsigned32(
      direction === "next"
        ? raw.sieve_next(requestLimbs.length, count)
        : raw.sieve_prev(requestLimbs.length, count),
    );
    const reachedMemoryLimit = raw.batch_reached_memory_limit() !== 0;
    if (primeCount === 0) return { primes: [], reachedMemoryLimit };

    const base = fromLimbs(
      new Uint32Array(
        raw.memory.buffer,
        unsigned32(raw.batch_base_limbs()),
        unsigned32(raw.batch_base_limb_count()),
      ),
    );
    const offsets = new BigUint64Array(raw.memory.buffer, unsigned32(raw.batch_offset_buffer()), primeCount);
    return { primes: Array.from(offsets, (offset) => base + offset), reachedMemoryLimit };
  }
}

// ── how many base primes a batch needs ───────────────────────────────────

/** ceil(√value), by Newton's method in BigInt, so it works at any size. */
export function ceilSquareRoot(value: bigint): bigint {
  if (value < 2n) return value;
  let estimate = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const better = (estimate + value / estimate) >> 1n;
    if (better >= estimate) break;
    estimate = better;
  }
  return estimate * estimate === value ? estimate : estimate + 1n;
}

/**
 * How many average prime gaps to allow per prime when guessing how far a
 * batch reaches. Generous: guessing short only means sieve_next builds the
 * rest of the base primes itself (counted as sieving time).
 */
const PRIME_GAP_MARGIN = 4;

/**
 * The base primes a batch will need: every prime up to √ of the last number it
 * is likely to sieve. Primes near x are about ln x apart, and the sieve always
 * works in whole segments.
 */
export function basePrimeLimitNeededFor(direction: Direction, from: bigint, count: number): bigint {
  const averagePrimeGap = naturalLog(from > 3n ? from : 3n);
  const likelyLastNumber =
    direction === "next"
      ? from + BigInt(Math.ceil(count * averagePrimeGap * PRIME_GAP_MARGIN)) + SEGMENT_SPAN
      : from + SEGMENT_SPAN;
  return ceilSquareRoot(likelyLastNumber);
}
