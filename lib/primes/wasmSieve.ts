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
  batch_reached_proven_bound(): number;
  batch_rejected_count(): number;
  batch_rejected_distances(): number;
  batch_rejected_evidence(): number;
  set_sieve_prime_cap(cap: bigint): void;
  /** Threaded build only: time spent measuring where splitting pays, since last asked. */
  take_measuring_ms?(): number;
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

/** No cap on the base primes a window is sieved with: UINT64_MAX in sieve.c. */
export const NO_SIEVE_PRIME_CAP = 2n ** 64n - 1n;

/**
 * A survivor of partial sieving that the sieve's Miller–Rabin found composite
 * (Phase 4), with the evidence, so it can be checked again (Requirement A3).
 */
export interface RejectedComposite {
  /** The number, exact, any size. */
  candidate: bigint;
  /** A small prime (2 to 41) that divides it, or a Miller–Rabin witness base. */
  evidence: number;
}

export interface SieveBatch {
  /** Ascending, exact, any size. */
  primes: bigint[];
  /** Composites rejected on the way, in the order the sieve met them (moving away from `from`). */
  rejected: RejectedComposite[];
  reachedMemoryLimit: boolean;
  /**
   * The sieve stopped at a candidate past Miller–Rabin's proven bound (a(13),
   * about 3.3 × 10^24): it and everything after it stay unchecked.
   */
  reachedProvenBound: boolean;
  /**
   * Part of the call spent measuring where splitting windows across threads
   * pays (threaded build only): setup, not sieving speed.
   */
  measuringMs: number;
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

  /**
   * Caps the base primes each window is sieved with (`NO_SIEVE_PRIME_CAP` for
   * none); survivors the sieve can't settle are proven by Miller–Rabin. A
   * uint64_t: Wasm takes the BigInt modulo 2^64, so values from 2^63 arrive intact.
   */
  setSievePrimeCap(cap: bigint): void {
    this.#raw.set_sieve_prime_cap(cap);
  }

  /** Up to `count` primes after (or before) `from`, ascending. */
  findPrimes(direction: Direction, from: bigint, count: number): SieveBatch {
    const raw = this.#raw;
    const requestLimbs = toLimbs(from);
    const requestPointer = unsigned32(raw.request_buffer(requestLimbs.length));
    if (requestLimbs.length > 0 && requestPointer === 0)
      return { primes: [], rejected: [], reachedMemoryLimit: true, reachedProvenBound: false, measuringMs: 0 };
    // A fresh view after every call: memory growth detaches old ones.
    new Uint32Array(raw.memory.buffer, requestPointer, requestLimbs.length).set(requestLimbs);

    const primeCount = unsigned32(
      direction === "next"
        ? raw.sieve_next(requestLimbs.length, count)
        : raw.sieve_prev(requestLimbs.length, count),
    );
    const reachedMemoryLimit = raw.batch_reached_memory_limit() !== 0;
    const reachedProvenBound = raw.batch_reached_proven_bound() !== 0;
    const measuringMs = raw.take_measuring_ms?.() ?? 0;
    const rejected = this.#rejectedComposites(direction, from);
    if (primeCount === 0) return { primes: [], rejected, reachedMemoryLimit, reachedProvenBound, measuringMs };

    const base = fromLimbs(
      new Uint32Array(
        raw.memory.buffer,
        unsigned32(raw.batch_base_limbs()),
        unsigned32(raw.batch_base_limb_count()),
      ),
    );
    const offsets = new BigUint64Array(raw.memory.buffer, unsigned32(raw.batch_offset_buffer()), primeCount);
    const primes = Array.from(offsets, (offset) => base + offset);
    return { primes, rejected, reachedMemoryLimit, reachedProvenBound, measuringMs };
  }

  /**
   * The last call's rejected composites: each is a distance from `from` (up
   * for "next", down for "prev") and its evidence, rebuilt exactly in BigInt.
   */
  #rejectedComposites(direction: Direction, from: bigint): RejectedComposite[] {
    const raw = this.#raw;
    const count = unsigned32(raw.batch_rejected_count());
    if (count === 0) return [];
    // Fresh views after the call: memory growth detaches old ones.
    const distances = new BigUint64Array(raw.memory.buffer, unsigned32(raw.batch_rejected_distances()), count);
    const evidence = new Uint32Array(raw.memory.buffer, unsigned32(raw.batch_rejected_evidence()), count);
    return Array.from(distances, (distance, index) => ({
      candidate: direction === "next" ? from + distance : from - distance,
      evidence: evidence[index],
    }));
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
