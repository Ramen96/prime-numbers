"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { addBatch, type Batch } from "./rollingBuffer.ts";

export type { Batch };

export type BufferStatus = "idle" | "computing" | "overflow" | "error";

/** What the list should do with its scroll position after the buffer changes. */
export type ScrollInstruction =
  /** Batches were added/removed above the view; move by this many rows so nothing jumps. */
  | { type: "keepPosition"; rowsAddedAbove: number }
  /** A jump just landed; put this prime at the top of the viewport. */
  | { type: "showPrimeAtTop"; primeIndex: number };

export interface JumpResult {
  /** Changes on every jump, so the UI can restart its "Jumped to…" message. */
  generation: number;
  requestedNumber: number;
  firstPrimeFound: number;
}

/**
 * How far into the edge batch the user must scroll before the next one is
 * requested. Scrolling down: 60% through the last batch. Scrolling up: 60% of
 * the way back through the first batch.
 */
const FETCH_THRESHOLD = 0.6;

/** Primes/sec at which heat is 0 (cool). */
const COOL_RATE = 1e7;
/** Primes/sec at which heat is 1 (overheating). */
const HOT_RATE = 1e3;

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
   * Primes per second over recent batches (see primeRateMeter.ts), or null
   * when there's no measured time yet: right after load or a jump.
   */
  primesPerSecond: number | null;
  /**
   * 0 (cool) to 1 (overheating), from primesPerSecond. Keeps its last value
   * while primesPerSecond is null, so the CPU doesn't flash cool after a jump.
   */
  heat: number;
  lastBatchDurationMs: number;
  /** The most recent completed jump, or null if the user hasn't jumped. */
  lastJump: JumpResult | null;
  /** Throw the buffer away and restart it at the first prime ≥ `target`. */
  jumpTo: (target: number) => void;
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

export function usePrimeBuffer(): PrimeBuffer {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [status, setStatus] = useState<BufferStatus>("idle");
  const [primesPerSecond, setPrimesPerSecond] = useState<number | null>(null);
  const [heat, setHeat] = useState(0);
  const [lastBatchDurationMs, setLastBatchDurationMs] = useState(0);
  const [lastJump, setLastJump] = useState<JumpResult | null>(null);

  // These refs hold the same values as state, but update instantly. The worker
  // message handler and the scroll handler read them, so they always see the
  // latest values instead of a stale snapshot from an earlier render.
  const workerRef = useRef<Worker | null>(null);
  const heldBatchesRef = useRef<Batch[]>([]);
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
    target: number;
    isUserJump: boolean;
    /** The primes ≥ target, held back until the batch below them arrives. */
    primesFromTarget: Float64Array | null;
  } | null>(null);
  const rowsAddedAboveRef = useRef(0);
  const primeToShowAtTopRef = useRef<number | null>(null);
  const rateWindowRef = useRef<RateWindow>(EMPTY_RATE_WINDOW);
  const stoppedRef = useRef(false); // set after overflow or error; no more requests

  /** Asks the worker for a batch. Ignored if one is already in progress. */
  const requestBatch = useCallback((direction: Direction, from: number) => {
    const worker = workerRef.current;
    if (!worker || pendingRequestRef.current || stoppedRef.current) return;

    const id = ++lastRequestIdRef.current;
    pendingRequestRef.current = { id, direction };
    setStatus("computing");

    const request: WorkerRequest = {
      type: "batch",
      id,
      generation: generationRef.current,
      direction,
      from,
      count: BATCH_SIZE,
    };
    worker.postMessage(request);
  }, []);

  /**
   * Starts a fresh buffer at the first prime ≥ `target`. Used for the initial
   * load (target 2) and for every jump.
   */
  const seedBuffer = useCallback(
    (target: number, isUserJump: boolean) => {
      // Anything already sent to the worker now belongs to an old generation.
      // The worker will still finish it, but the response gets ignored.
      generationRef.current++;
      pendingRequestRef.current = null;
      stoppedRef.current = false;

      heldBatchesRef.current = [];
      // Measure the new region on its own, not averaged with where we were.
      rateWindowRef.current = EMPTY_RATE_WINDOW;
      rowsAddedAboveRef.current = 0;
      primeToShowAtTopRef.current = null;
      pendingSeedRef.current = { target, isUserJump, primesFromTarget: null };

      // "next" returns primes strictly greater than `from`, so this asks for primes ≥ target.
      requestBatch("next", target - 1);
    },
    [requestBatch],
  );

  const jumpTo = useCallback(
    (target: number) => {
      // Clear the screen right away, so old primes don't linger while the
      // worker computes the new ones.
      setBatches([]);
      setLastJump(null);
      setPrimesPerSecond(null);
      seedBuffer(target, true);
    },
    [seedBuffer],
  );

  useEffect(() => {
    const worker = new Worker(new URL("./primes.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const isFromCurrentGeneration = response.generation === generationRef.current;
      const isAnswerToPendingRequest = response.id === pendingRequestRef.current?.id;
      if (!isFromCurrentGeneration || !isAnswerToPendingRequest) return;
      pendingRequestRef.current = null;

      if (response.type === "overflow") {
        stoppedRef.current = true;
        setStatus("overflow");
        return;
      }
      if (response.type === "error") {
        stoppedRef.current = true;
        console.error("prime worker:", response.message);
        setStatus("error");
        return;
      }

      setStatus("idle");
      const { primes: newPrimes, durationMs, direction } = response;
      if (newPrimes.length === 0) return; // asked for primes before 2; there are none

      // Update the primes-per-second counter. Only batches add to the rate,
      // so when the worker is idle it simply holds its last value.
      rateWindowRef.current = recordBatch(rateWindowRef.current, {
        primeCount: newPrimes.length,
        measuredDurationMs: durationMs,
      });
      const measuredRate = measurePrimesPerSecond(rateWindowRef.current);
      setPrimesPerSecond(measuredRate);
      if (measuredRate !== null) setHeat(heatFromRate(measuredRate));
      setLastBatchDurationMs(durationMs);

      const pendingSeed = pendingSeedRef.current;
      if (pendingSeed) {
        const isFirstHalfOfSeed = pendingSeed.primesFromTarget === null;
        const hasPrimesBelow = newPrimes[0] > 2;
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
    };

    /** Shows a freshly seeded buffer, landing the view on the first prime ≥ target. */
    function finishSeeding(
      target: number,
      isUserJump: boolean,
      primesFromTarget: Float64Array,
      primesBelowTarget: Float64Array | null,
    ) {
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
    }

    worker.onerror = (errorEvent) => {
      stoppedRef.current = true;
      console.error("prime worker crashed:", errorEvent.message);
      setStatus("error");
    };

    seedBuffer(2, false);

    return () => {
      worker.terminate();
      workerRef.current = null;
      pendingRequestRef.current = null;
    };
  }, [requestBatch, seedBuffer]);

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
        const largestPrimeHeld = lastBatch.primes[lastBatch.primes.length - 1];
        requestBatch("next", largestPrimeHeld);
        return;
      }

      // Scrolling up: has the top of the screen gone 60% back into the first batch?
      const firstBatch = heldBatches[0];
      const smallestPrimeHeld = firstBatch.primes[0];
      const fetchPreviousAt = (1 - FETCH_THRESHOLD) * firstBatch.primes.length;
      const nothingBeforeThis = smallestPrimeHeld === 2;

      if (!nothingBeforeThis && firstVisiblePrime < fetchPreviousAt) {
        requestBatch("prev", smallestPrimeHeld);
      }
    },
    [requestBatch],
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
    lastJump,
    jumpTo,
    reportView,
    takeScrollInstruction,
  };
}
