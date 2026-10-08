/// <reference lib="webworker" />
// Loads the sieve inside primes.worker.ts: the threaded build when the
// browser can run it, the standalone single-threaded build otherwise. Both
// come from wasm/sieve.c and give identical primes; WasmSieve (wasmSieve.ts)
// is the boundary for both.
//
// The threaded build (public/sieve-threads/, `npm run build:wasm:threads`)
// is Emscripten's pthreads output: a JavaScript loader (sieve.mjs) that
// starts one nested worker per helper thread, all sharing one memory. It's
// loaded from /public at run time, not bundled, because it starts those
// workers from its own URL. It needs:
// - cross-origin isolation, for SharedArrayBuffer (next.config.ts headers),
// - nested workers, and their script actually loading,
// - a shared memory the browser agrees to reserve,
// - at least 2 sieving threads (one fewer than the cores, so the page keeps one).
// If any of that fails, the standalone build (public/sieve.wasm) is used, so
// the list always works; it's just slower.

import { basePrimeBudgetWithin, basePrimeMemoryBudget, moduleMemoryBudget, sharedMemoryMaximumsToTry, WASM_PAGE_BYTES } from "./memoryBudget.ts";
import { rawExportsOf, THREADED_INITIAL_MEMORY_BYTES, type CreateSieveModule } from "./threadedSieveModule.ts";
import { WasmSieve, type RawSieveExports } from "./wasmSieve.ts";

declare const self: DedicatedWorkerGlobalScope;

export interface LoadedSieve {
  sieve: WasmSieve;
  /** Threads sieving each window, the worker's own included. */
  threads: number;
  /** The base-prime budget the sieve was given, or null for "until an allocation fails". */
  memoryBudgetBytes: number | null;
}

/** One fewer than the cores, at least 1: the page keeps a core to stay smooth. */
export function sievingThreadsFor(hardwareConcurrency: number | undefined): number {
  return Math.max(1, (hardwareConcurrency ?? 1) - 1);
}

const THREADED_LOADER_URL = "/sieve-threads/sieve.mjs";
/** Starting the threads normally takes 10–75 ms; this only catches a start that never finishes. */
const THREADED_START_TIMEOUT_MS = 15_000;

export async function loadSieve(): Promise<LoadedSieve> {
  const deviceMemoryGiB = (self.navigator as WorkerNavigator & { deviceMemory?: number }).deviceMemory;
  const threads = sievingThreadsFor(self.navigator.hardwareConcurrency);
  if (threads > 1 && self.crossOriginIsolated && typeof SharedArrayBuffer === "function" && typeof Worker === "function") {
    try {
      return await loadThreadedSieve(threads, moduleMemoryBudget(deviceMemoryGiB));
    } catch (error) {
      console.warn("Sieving on one thread: the threaded sieve couldn't start.", error);
    }
  }
  return loadStandaloneSieve(basePrimeMemoryBudget(deviceMemoryGiB));
}

async function loadStandaloneSieve(memoryBudgetBytes: number | null): Promise<LoadedSieve> {
  const { instance } = await WebAssembly.instantiateStreaming(fetch("/sieve.wasm"), {
    // Called when the module's memory grows. Nothing to do here: WasmSieve
    // reads through a fresh view of memory.buffer every time.
    env: { emscripten_notify_memory_growth: () => {} },
  });
  const raw = instance.exports as unknown as RawSieveExports;
  raw._initialize?.();
  const sieve = new WasmSieve(raw);
  if (memoryBudgetBytes !== null) sieve.setBasePrimeMemoryBudget(memoryBudgetBytes);
  return { sieve, threads: 1, memoryBudgetBytes };
}

/** The largest shared memory the browser agrees to reserve, from the maximums to try. */
function createSharedMemory(moduleBudget: number | null): { memory: WebAssembly.Memory; maximumBytes: number } {
  for (const maximumBytes of sharedMemoryMaximumsToTry(moduleBudget)) {
    try {
      const memory = new WebAssembly.Memory({
        initial: THREADED_INITIAL_MEMORY_BYTES / WASM_PAGE_BYTES,
        maximum: maximumBytes / WASM_PAGE_BYTES,
        shared: true,
      });
      return { memory, maximumBytes };
    } catch {
      // RangeError: this browser won't reserve that much. Try half.
    }
  }
  throw new Error("no shared memory could be reserved");
}

/** This worker's global scope, which can start nested workers (TypeScript's webworker types omit Worker). */
const workerScope = globalThis as unknown as { Worker: typeof Worker };

async function loadThreadedSieve(threads: number, moduleBudget: number | null): Promise<LoadedSieve> {
  const { memory, maximumBytes } = createSharedMemory(moduleBudget);
  const helperThreads = threads - 1;

  // Track the workers the loader starts, so a failed start can end them, and
  // catch a helper whose script fails to load: Emscripten rethrows that from
  // an event handler, where no try/catch can reach it.
  const RealWorker = workerScope.Worker;
  const startedWorkers: { terminate(): void }[] = [];
  workerScope.Worker = class extends RealWorker {
    constructor(scriptURL: string | URL, options?: WorkerOptions) {
      super(scriptURL, options);
      startedWorkers.push(this);
    }
  };
  let onHelperError: (event: ErrorEvent) => void = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const helperFailed = new Promise<never>((_, reject) => {
    onHelperError = (event) => {
      event.preventDefault(); // handled here: fall back instead of crashing the worker
      reject(new Error(`a sieve thread failed to start: ${event.message}`));
    };
    self.addEventListener("error", onHelperError);
    timer = setTimeout(() => reject(new Error("the sieve threads took too long to start")), THREADED_START_TIMEOUT_MS);
  });

  try {
    const loaderUrl = THREADED_LOADER_URL; // a variable, so the bundler leaves it alone
    const loader = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ loaderUrl)) as {
      default: CreateSieveModule;
    };
    const sieveModule = await Promise.race([
      loader.default({ wasmMemory: memory, sieveHelperThreads: helperThreads }),
      helperFailed,
    ]);
    const helpersStarted = sieveModule._sieve_start_helpers(helperThreads);
    if (helpersStarted < 1) throw new Error("no sieve threads started");

    const raw = rawExportsOf(sieveModule);
    const sieve = new WasmSieve(raw);
    // The memory's maximum is the whole module's limit; base primes get it
    // minus the allowance for everything else.
    const memoryBudgetBytes = basePrimeBudgetWithin(maximumBytes);
    sieve.setBasePrimeMemoryBudget(memoryBudgetBytes);
    return { sieve, threads: helpersStarted + 1, memoryBudgetBytes };
  } catch (error) {
    startedWorkers.forEach((worker) => worker.terminate());
    throw error;
  } finally {
    workerScope.Worker = RealWorker;
    self.removeEventListener("error", onHelperError);
    clearTimeout(timer);
  }
}
