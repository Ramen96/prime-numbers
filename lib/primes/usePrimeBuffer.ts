"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BATCH_SIZE,
  type Direction,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol";
import {
  EMPTY_RATE_WINDOW,
  measurePrimesPerSecond,
  recordBatch,
  type RateWindow,
} from "./primeRateMeter.ts";
import { estimatedBasePrimeBytes, shouldRestartWorkerToReleaseMemory } from "./memoryBudget.ts";
import { addBatch, MAX_BATCHES, type Batch } from "./rollingBuffer.ts";
import { basePrimeLimitNeededFor } from "./wasmSieve.ts";

export type { Batch };

export type BufferStatus =
  | "idle"
  | "computing"
  | "building-base-primes"
  | "stopped"
  | "error";

/** What the list should do with its scroll position after the buffer changes. */
export type ScrollInstruction =
  /** Batches were added/removed above the view; move by this many rows so nothing jumps. */
  | { type: "keepPosition"; rowsAddedAbove: number }
  /** A jump just landed; put this prime at the top of the viewport. */
  | { type: "showPrimeAtTop"; primeIndex: number };

export interface JumpResult {
  /** Changes on every jump, so the UI can restart its "Jumped to…" message. */
  generation: number;
  requestedNumber: bigint;
  firstPrimeFound: bigint;
}

/**
 * How far into the edge batch the user must scroll before the next one is
 * requested. Scrolling down: 60% through the last batch. Scrolling up: 60% of
 * the way back through the first batch.
 */
const FETCH_THRESHOLD = 0.6;
/** Show the Stop button only once a calculation has run this long, so it doesn't flash. */
const STOP_BUTTON_DELAY_MS = 300;

/** Primes/sec at which heat is 0 (cool). */
const COOL_RATE = 1e7;
/** Primes/sec at which heat is 1 (overheating). */
const HOT_RATE = 1e5; // about where the sieve ends up just below 2^53

/**
 * Maps primes/sec to heat in 0..1 on a log scale, because the rate falls
 * across orders of magnitude. Fast = cool (0), slow = hot (1).
 */
export function heatFromRate(primesPerSecond: number): number {
  if (!(primesPerSecond > 0)) return 0;
  const coolExponent = Math.log10(COOL_RATE);
  const hotExponent = Math.log10(HOT_RATE);
  const progressTowardHot =
    (coolExponent - Math.log10(primesPerSecond)) / (coolExponent - hotExponent);
  return Math.min(1, Math.max(0, progressTowardHot));
}

export interface PrimeBuffer {
  batches: Batch[];
  status: BufferStatus;
  /**
   * Primes per second of sieving over recent batches (see primeRateMeter.ts),
   * or null when there's no measured time yet: right after load or a jump.
   */
  primesPerSecond: number | null;
  /**
   * 0 (cool) to 1 (overheating), from primesPerSecond. Keeps its last value
   * while primesPerSecond is null, so the CPU doesn't flash cool after a jump.
   */
  heat: number;
  /** Sieving time of the last batch; null until the worker has computed one. */
  lastBatchDurationMs: number | null;
  /** How long building base primes took the last time it was needed; null before then. */
  lastBasePrimeSetupMs: number | null;
  /** Bytes the worker holds for base primes; null until it has reported. */
  basePrimeMemoryBytes: number | null;
  /** How long re-checking the last batch with Miller–Rabin took; null before the first. */
  lastVerificationMs: number | null;
  /** Why the worker stopped with an error (e.g. a verification disagreement), or null. */
  errorMessage: string | null;
  /** True once the current calculation has run long enough to offer a Stop button. */
  calculationIsSlow: boolean;
  /**
   * The sieve reached this device's memory limit going up: the base primes it
   * needs next don't fit. The list stops at the last proven prime. Cleared by a jump.
   */
  reachedMemoryLimit: boolean;
  /** The most recent completed jump, or null if the user hasn't jumped. */
  lastJump: JumpResult | null;
  /** Throw the buffer away and restart it at the first prime ≥ `target`. */
  jumpTo: (target: bigint) => void;
  /**
   * Stops calculating: terminates the worker mid-calculation and keeps the
   * primes already on screen. Scrolling to a fetch threshold or jumping starts
   * a fresh worker.
   */
  stop: () => void;
  /**
   * The list calls this whenever the view changes, with the buffer positions
   * of the first and last primes on screen. Requests a batch if the user has
   * scrolled past a threshold.
   */
  reportView: (firstVisiblePrime: number, lastVisiblePrime: number) => void;
  /**
   * The list calls this after every buffer change to learn how to adjust its
   * scroll position. Returns null if nothing needs to move. Reading it clears it.
   */
  takeScrollInstruction: () => ScrollInstruction | null;
}

/**
 * The first batch, computed on the server at build time and rendered into the
 * page's HTML. It arrives as strings (BigInt can't be passed from a server
 * component), so the first screen of primes needs no worker round trip.
 */
function batchesFromServer(firstBatchFromServer: readonly string[]): Batch[] {
  if (firstBatchFromServer.length === 0) return [];
  const primes = firstBatchFromServer.map((prime) => BigInt(prime));
  return addBatch([], primes, "next").batches;
}

/** "next" finds primes strictly greater than `from`, so primes ≥ target start just below it. */
function searchStartFor(target: bigint): bigint {
  return target > 0n ? target - 1n : 0n;
}

export function usePrimeBuffer(firstBatchFromServer: readonly string[]): PrimeBuffer {
  const [batches, setBatches] = useState<Batch[]>(() => batchesFromServer(firstBatchFromServer));
  const [status, setStatus] = useState<BufferStatus>("idle");
  const [primesPerSecond, setPrimesPerSecond] = useState<number | null>(null);
  const [heat, setHeat] = useState(0);
  const [lastBatchDurationMs, setLastBatchDurationMs] = useState<number | null>(null);
  const [lastBasePrimeSetupMs, setLastBasePrimeSetupMs] = useState<number | null>(null);
  const [lastVerificationMs, setLastVerificationMs] = useState<number | null>(null);
  const [basePrimeMemoryBytes, setBasePrimeMemoryBytes] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [calculationIsSlow, setCalculationIsSlow] = useState(false);
  const [lastJump, setLastJump] = useState<JumpResult | null>(null);
  const [reachedMemoryLimit, setReachedMemoryLimit] = useState(false);

  // These refs hold the same values as state, but update instantly. The worker
  // message handler and the scroll handler read them, so they always see the
  // latest values instead of a stale snapshot from an earlier render.
  const workerRef = useRef<Worker | null>(null);
  /** Everything the current worker's Wasm module holds, from its last report. */
  const workerMemoryBytesRef = useRef(0);
  const heldBatchesRef = useRef<Batch[]>(batches);
  const pendingRequestRef = useRef<{ id: number; direction: Direction } | null>(null);
  const lastRequestIdRef = useRef(0);
  /** Bumped on every seed/jump. Responses tagged with an older generation are ignored. */
  const generationRef = useRef(0);
  /**
   * Set while a new buffer is being seeded. A seed is two batches: the primes
   * ≥ target, then the primes just below them. Both are shown together in a
   * single update, so the jump lands in one step: the first prime ≥ target at
   * the top, room to scroll up, and labels that don't flip from estimated to
   * exact a moment later.
   */
  const pendingSeedRef = useRef<{
    target: bigint;
    isUserJump: boolean;
    /** The primes ≥ target, held back until the batch below them arrives. */
    primesFromTarget: readonly bigint[] | null;
  } | null>(null);
  const rowsAddedAboveRef = useRef(0);
  const primeToShowAtTopRef = useRef<number | null>(null);
  const rateWindowRef = useRef<RateWindow>(EMPTY_RATE_WINDOW);
  /** Set after an error: nothing more can be calculated in this buffer. */
  const cannotContinueRef = useRef(false);
  /**
   * Set when the sieve reached this device's memory limit going up: the list
   * stops at the last proven prime. Scrolling back down still works.
   */
  const memoryLimitReachedRef = useRef(false);
  /**
   * True from page load until the buffer holds MAX_BATCHES. The server sends
   * the first batch, so nothing has been timed yet; filling the buffer right
   * away gives the counter a real measurement within moments of loading.
   */
  const fillingOnLoadRef = useRef(true);
  const slowCalculationTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The worker calls through this, so a restarted worker uses the current handler. */
  const handleWorkerMessageRef = useRef<(response: WorkerResponse) => void>(() => {});

  const startWorker = useCallback((): Worker => {
    const worker = new Worker(new URL("./primes.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) =>
      handleWorkerMessageRef.current(event.data);
    worker.onerror = (errorEvent) => {
      cannotContinueRef.current = true;
      console.error("prime worker crashed:", errorEvent.message);
      setStatus("error");
    };
    workerRef.current = worker;
    return worker;
  }, []);

  const clearSlowCalculation = useCallback(() => {
    clearTimeout(slowCalculationTimerRef.current);
    setCalculationIsSlow(false);
  }, []);

  /**
   * Ends the current worker, even in the middle of a long Wasm call (terminate
   * is the only way to interrupt one), and forgets its pending request. The
   * next request starts a fresh worker, which rebuilds its base primes.
   * Used by Stop, and by jumps that arrive while a calculation is running.
   */
  const discardWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    workerMemoryBytesRef.current = 0;
    pendingRequestRef.current = null;
    clearSlowCalculation();
  }, [clearSlowCalculation]);

  /** Asks the worker for a batch, starting a worker if there isn't one. Ignored if one is in progress. */
  const requestBatch = useCallback(
    (direction: Direction, from: bigint) => {
      if (pendingRequestRef.current || cannotContinueRef.current) return;
      if (direction === "next" && memoryLimitReachedRef.current) return;
      const worker = workerRef.current ?? startWorker();

      const id = ++lastRequestIdRef.current;
      pendingRequestRef.current = { id, direction };
      setStatus("computing");
      clearTimeout(slowCalculationTimerRef.current);
      slowCalculationTimerRef.current = setTimeout(() => {
        if (pendingRequestRef.current?.id === id) setCalculationIsSlow(true);
      }, STOP_BUTTON_DELAY_MS);

      const request: WorkerRequest = {
        type: "batch",
        id,
        generation: generationRef.current,
        direction,
        from,
        count: BATCH_SIZE,
      };
      worker.postMessage(request);
    },
    [startWorker],
  );

  const requestNextAfter = useCallback(
    (heldBatches: Batch[]) => {
      const lastBatch = heldBatches[heldBatches.length - 1];
      requestBatch("next", lastBatch.primes[lastBatch.primes.length - 1]);
    },
    [requestBatch],
  );

  /**
   * Starts a fresh buffer at the first prime ≥ `target`. Used for the initial
   * load (when the server sent no first batch) and for every jump.
   */
  const seedBuffer = useCallback(
    (target: bigint, isUserJump: boolean) => {
      // Anything already sent to the worker now belongs to an old generation.
      // If it's still calculating, don't wait for it: restart the worker.
      generationRef.current++;
      if (pendingRequestRef.current) discardWorker();
      cannotContinueRef.current = false;
      memoryLimitReachedRef.current = false;

      heldBatchesRef.current = [];
      // Measure the new region on its own, not averaged with where we were.
      rateWindowRef.current = EMPTY_RATE_WINDOW;
      rowsAddedAboveRef.current = 0;
      primeToShowAtTopRef.current = null;
      pendingSeedRef.current = { target, isUserJump, primesFromTarget: null };
      fillingOnLoadRef.current = false;

      requestBatch("next", searchStartFor(target));
    },
    [discardWorker, requestBatch],
  );

  const jumpTo = useCallback(
    (target: bigint) => {
      // Clear the screen right away, so old primes don't linger while the
      // worker computes the new ones.
      setBatches([]);
      setLastJump(null);
      setPrimesPerSecond(null);
      setReachedMemoryLimit(false);
      setErrorMessage(null);
      // Wasm memory never shrinks. If the worker grew for somewhere far away
      // and this jump needs much less, start a fresh one to give it back.
      const bytesNeeded = estimatedBasePrimeBytes(
        basePrimeLimitNeededFor("next", searchStartFor(target), BATCH_SIZE),
      );
      if (shouldRestartWorkerToReleaseMemory(workerMemoryBytesRef.current, bytesNeeded)) {
        discardWorker();
        setBasePrimeMemoryBytes(null);
      }
      seedBuffer(target, true);
    },
    [discardWorker, seedBuffer],
  );

  const stop = useCallback(() => {
    discardWorker();
    pendingSeedRef.current = null;
    fillingOnLoadRef.current = false;
    setStatus("stopped");
  }, [discardWorker]);

  /** Shows a freshly seeded buffer, landing the view on the first prime ≥ target. */
  const finishSeeding = useCallback(
    (
      target: bigint,
      isUserJump: boolean,
      primesFromTarget: readonly bigint[],
      primesBelowTarget: readonly bigint[] | null,
    ) => {
      pendingSeedRef.current = null;

      let seeded = addBatch([], primesFromTarget, "next");
      if (primesBelowTarget) seeded = addBatch(seeded.batches, primesBelowTarget, "prev");
      // The batch below was added above the first prime ≥ target, pushing it down this many rows.
      const positionOfFirstPrimeFromTarget = seeded.rowsAddedAbove;

      rowsAddedAboveRef.current = 0;
      heldBatchesRef.current = seeded.batches;
      setBatches(seeded.batches);

      if (isUserJump) {
        primeToShowAtTopRef.current = positionOfFirstPrimeFromTarget;
        setLastJump({
          generation: generationRef.current,
          requestedNumber: target,
          firstPrimeFound: primesFromTarget[0],
        });
      }
    },
    [],
  );

  const handleWorkerMessage = useCallback(
    (response: WorkerResponse) => {
      const isFromCurrentGeneration = response.generation === generationRef.current;
      const isAnswerToPendingRequest = response.id === pendingRequestRef.current?.id;
      if (!isFromCurrentGeneration || !isAnswerToPendingRequest) return;

      if (response.type === "building-base-primes") {
        setStatus("building-base-primes"); // the batch itself is still on its way
        return;
      }

      pendingRequestRef.current = null;
      clearSlowCalculation();
      if (response.type === "batch" || response.type === "memory-limit") {
        workerMemoryBytesRef.current = response.memory.moduleBytes;
        setBasePrimeMemoryBytes(response.memory.basePrimeBytes);
      }

      if (response.type === "memory-limit") {
        // Nothing more could be proven this way. A jump that couldn't prove
        // even its first prime leaves an empty list, with the notice explaining.
        memoryLimitReachedRef.current = true;
        pendingSeedRef.current = null;
        fillingOnLoadRef.current = false;
        setReachedMemoryLimit(true);
        setStatus("idle");
        return;
      }
      if (response.type === "error") {
        cannotContinueRef.current = true;
        console.error("prime worker:", response.message);
        setErrorMessage(response.message);
        setStatus("error");
        return;
      }

      setStatus("idle");
      const { primes: newPrimes, sievingDurationMs, setupDurationMs, direction } = response;
      if (setupDurationMs > 0) setLastBasePrimeSetupMs(setupDurationMs);
      setLastVerificationMs(response.verificationDurationMs);
      if (response.reachedMemoryLimit && direction === "next") {
        // These primes are proven; nothing after them could be checked.
        memoryLimitReachedRef.current = true;
        fillingOnLoadRef.current = false;
        setReachedMemoryLimit(true);
      }
      if (newPrimes.length === 0) return; // asked for primes before 2; there are none

      // Update the primes-per-second counter from sieving time only. Only
      // batches add to the rate, so when the worker is idle it holds its value.
      rateWindowRef.current = recordBatch(rateWindowRef.current, {
        primeCount: newPrimes.length,
        sievingDurationMs,
        setupDurationMs,
      });
      const measuredRate = measurePrimesPerSecond(rateWindowRef.current);
      setPrimesPerSecond(measuredRate);
      if (measuredRate !== null) setHeat(heatFromRate(measuredRate));
      setLastBatchDurationMs(sievingDurationMs);

      const pendingSeed = pendingSeedRef.current;
      if (pendingSeed) {
        const isFirstHalfOfSeed = pendingSeed.primesFromTarget === null;
        const hasPrimesBelow = newPrimes[0] > 2n;
        if (isFirstHalfOfSeed && hasPrimesBelow) {
          pendingSeed.primesFromTarget = newPrimes;
          requestBatch("prev", newPrimes[0]);
          return;
        }
        const primesFromTarget = pendingSeed.primesFromTarget ?? newPrimes;
        const primesBelowTarget = isFirstHalfOfSeed ? null : newPrimes;
        finishSeeding(pendingSeed.target, pendingSeed.isUserJump, primesFromTarget, primesBelowTarget);
        return;
      }

      const { batches: updatedBatches, rowsAddedAbove } = addBatch(
        heldBatchesRef.current,
        newPrimes,
        direction,
      );
      rowsAddedAboveRef.current += rowsAddedAbove;
      heldBatchesRef.current = updatedBatches;
      setBatches(updatedBatches);

      if (fillingOnLoadRef.current) {
        if (updatedBatches.length < MAX_BATCHES) requestNextAfter(updatedBatches);
        else fillingOnLoadRef.current = false;
      }
    },
    [clearSlowCalculation, finishSeeding, requestBatch, requestNextAfter],
  );

  // A layout effect, so it's in place before any child's effect can start a worker.
  useLayoutEffect(() => {
    handleWorkerMessageRef.current = handleWorkerMessage;
  }, [handleWorkerMessage]);

  /**
   * Sends whatever was waiting for a worker: a jump made before it existed, a
   * seed cut off when a previous worker was terminated, or the on-load fill.
   */
  const resumeWork = useCallback(() => {
    const pendingSeed = pendingSeedRef.current;
    if (pendingSeed?.primesFromTarget) {
      requestBatch("prev", pendingSeed.primesFromTarget[0]);
    } else if (pendingSeed) {
      requestBatch("next", searchStartFor(pendingSeed.target));
    } else if (heldBatchesRef.current.length === 0) {
      seedBuffer(2n, false); // no first batch from the server
    } else if (fillingOnLoadRef.current) {
      requestNextAfter(heldBatchesRef.current);
    }
  }, [requestBatch, requestNextAfter, seedBuffer]);

  useEffect(() => {
    if (!workerRef.current) startWorker();
    if (!pendingRequestRef.current) resumeWork();
    return () => {
      clearTimeout(slowCalculationTimerRef.current);
      workerRef.current?.terminate();
      workerRef.current = null;
      pendingRequestRef.current = null;
    };
  }, [resumeWork, startWorker]);

  const reportView = useCallback(
    (firstVisiblePrime: number, lastVisiblePrime: number) => {
      const heldBatches = heldBatchesRef.current;
      if (heldBatches.length === 0) return;

      // Scrolling down: has the bottom of the screen gone 60% into the last batch?
      const totalPrimesHeld = heldBatches.reduce((count, batch) => count + batch.primes.length, 0);
      const lastBatch = heldBatches[heldBatches.length - 1];
      const lastBatchStartsAt = totalPrimesHeld - lastBatch.primes.length;
      const fetchNextAt = lastBatchStartsAt + FETCH_THRESHOLD * lastBatch.primes.length;

      if (lastVisiblePrime >= fetchNextAt) {
        requestNextAfter(heldBatches);
        return;
      }

      // Scrolling up: has the top of the screen gone 60% back into the first batch?
      const firstBatch = heldBatches[0];
      const smallestPrimeHeld = firstBatch.primes[0];
      const fetchPreviousAt = (1 - FETCH_THRESHOLD) * firstBatch.primes.length;
      const nothingBeforeThis = smallestPrimeHeld === 2n;

      if (!nothingBeforeThis && firstVisiblePrime < fetchPreviousAt) {
        requestBatch("prev", smallestPrimeHeld);
      }
    },
    [requestBatch, requestNextAfter],
  );

  const takeScrollInstruction = useCallback((): ScrollInstruction | null => {
    const primeToShowAtTop = primeToShowAtTopRef.current;
    const rowsAddedAbove = rowsAddedAboveRef.current;
    primeToShowAtTopRef.current = null;
    rowsAddedAboveRef.current = 0;

    if (primeToShowAtTop !== null) return { type: "showPrimeAtTop", primeIndex: primeToShowAtTop };
    if (rowsAddedAbove !== 0) return { type: "keepPosition", rowsAddedAbove };
    return null;
  }, []);

  return {
    batches,
    status,
    primesPerSecond,
    heat,
    lastBatchDurationMs,
    lastBasePrimeSetupMs,
    lastVerificationMs,
    basePrimeMemoryBytes,
    errorMessage,
    calculationIsSlow,
    reachedMemoryLimit,
    lastJump,
    jumpTo,
    stop,
    reportView,
    takeScrollInstruction,
  };
}
