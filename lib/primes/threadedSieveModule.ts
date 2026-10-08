// The threaded build (public/sieve-threads/sieve.mjs, Emscripten pthreads)
// as WasmSieve sees it. Shared by the worker's loader (loadSieve.ts) and the
// Wasm tests, so both go through the same boundary.

import type { RawSieveExports } from "./wasmSieve.ts";

/** The threaded module's starting memory: Emscripten's default INITIAL_MEMORY. */
export const THREADED_INITIAL_MEMORY_BYTES = 16 * 2 ** 20;

/** The parts of the Emscripten module the sieve uses (its exports are prefixed with _). */
export interface ThreadedSieveModule {
  wasmMemory: WebAssembly.Memory;
  _request_buffer(limbCount: number): number;
  _sieve_next(requestLimbCount: number, count: number): number;
  _sieve_prev(requestLimbCount: number, count: number): number;
  _batch_base_limbs(): number;
  _batch_base_limb_count(): number;
  _batch_offset_buffer(): number;
  _batch_reached_memory_limit(): number;
  _base_prime_limit(): bigint;
  _extend_base_primes(limit: bigint): number;
  _set_base_prime_memory_budget(bytes: number): void;
  _reserve_base_prime_storage(bytes: number): number;
  _base_prime_memory_bytes(): number;
  _sieve_start_helpers(count: number): number;
  _set_parallel_threshold(checkpoints: number): void;
  _measured_parallel_threshold(): number;
  _take_measuring_ms(): number;
}

/**
 * Creates the module. `wasmMemory` is a shared memory the caller made, so the
 * caller chooses its maximum (see memoryBudget.ts); `sieveHelperThreads` is
 * how many thread workers to start up front (PTHREAD_POOL_SIZE in package.json).
 */
export type CreateSieveModule = (options: {
  wasmMemory: WebAssembly.Memory;
  sieveHelperThreads: number;
}) => Promise<ThreadedSieveModule>;

/** The module's exports under the names WasmSieve expects, values untouched. */
export function rawExportsOf(sieveModule: ThreadedSieveModule): RawSieveExports {
  return {
    memory: sieveModule.wasmMemory,
    request_buffer: sieveModule._request_buffer,
    sieve_next: sieveModule._sieve_next,
    sieve_prev: sieveModule._sieve_prev,
    batch_base_limbs: sieveModule._batch_base_limbs,
    batch_base_limb_count: sieveModule._batch_base_limb_count,
    batch_offset_buffer: sieveModule._batch_offset_buffer,
    batch_reached_memory_limit: sieveModule._batch_reached_memory_limit,
    base_prime_limit: sieveModule._base_prime_limit,
    extend_base_primes: sieveModule._extend_base_primes,
    set_base_prime_memory_budget: sieveModule._set_base_prime_memory_budget,
    reserve_base_prime_storage: sieveModule._reserve_base_prime_storage,
    base_prime_memory_bytes: sieveModule._base_prime_memory_bytes,
    take_measuring_ms: sieveModule._take_measuring_ms,
  };
}
