// Pure functions for the rolling buffer: adding a batch at either end,
// dropping one from the other end, and labelling each prime with its
// position (#n). No React or worker code here, so it can be unit tested.

import { estimatePrimeOrdinal } from "./logarithmicIntegral.ts";
import type { Direction } from "./protocol.ts";

export interface Batch {
  primes: Float64Array;
  /** Which prime primes[0] is, counting from 1: 2 is #1, 3 is #2, 5 is #3, … */
  ordinalOfFirstPrime: number;
  /**
   * True after a jump. We estimate the position of the first prime the jump
   * found (the anchor) once, using li(x), and count exactly from there, so
   * the labels are all off by the same small amount. They become exact once
   * the buffer reaches 2.
   */
  ordinalIsEstimate: boolean;
}

/** Batches held at once. Memory stays flat at MAX_BATCHES × BATCH_SIZE primes. */
export const MAX_BATCHES = 3;

export interface BufferUpdate {
  batches: Batch[];
  /**
   * How many rows were added (+) or removed (−) above the rows that were
   * already on screen. The list scrolls by this much so nothing appears to jump.
   */
  rowsAddedAbove: number;
}

/**
 * Adds a batch from the worker to one end of the buffer. If that makes more
 * than MAX_BATCHES, drops a batch from the other end.
 *
 * Adding "next" to an empty buffer starts a new one (initial load or a jump):
 * its first prime becomes the anchor and gets an estimated position.
 */
export function addBatch(
  heldBatches: Batch[],
  newPrimes: Float64Array,
  direction: Direction,
): BufferUpdate {
  let batches: Batch[];
  let rowsAddedAbove = 0;

  if (heldBatches.length === 0) {
    batches = [startNewBuffer(newPrimes)];
  } else if (direction === "next") {
    const lastBatch = heldBatches[heldBatches.length - 1];
    const newBatch: Batch = {
      primes: newPrimes,
      ordinalOfFirstPrime: lastBatch.ordinalOfFirstPrime + lastBatch.primes.length,
      ordinalIsEstimate: lastBatch.ordinalIsEstimate,
    };
    batches = [...heldBatches, newBatch];

    if (batches.length > MAX_BATCHES) {
      const droppedBatch = batches[0];
      rowsAddedAbove -= droppedBatch.primes.length;
      batches = batches.slice(1);
    }
  } else {
    const firstBatch = heldBatches[0];
    const newBatch: Batch = {
      primes: newPrimes,
      ordinalOfFirstPrime: firstBatch.ordinalOfFirstPrime - newPrimes.length,
      ordinalIsEstimate: firstBatch.ordinalIsEstimate,
    };
    batches = [newBatch, ...heldBatches];
    rowsAddedAbove += newPrimes.length;

    if (batches.length > MAX_BATCHES) {
      batches = batches.slice(0, -1); // drop the last batch
    }
  }

  return { batches: numberExactlyIfBufferContainsTwo(batches), rowsAddedAbove };
}

/**
 * True while the buffer's position labels are estimates: after a jump, until
 * the buffer reaches 2. The "≈" on each label and the estimate banner both
 * use this, so they always agree.
 */
export function bufferLabelsAreEstimated(batches: Batch[]): boolean {
  // Every batch shares the same flag: it's set on the whole buffer after a
  // jump and cleared on the whole buffer once 2 is in it.
  return batches[0]?.ordinalIsEstimate ?? false;
}

function startNewBuffer(primes: Float64Array): Batch {
  const anchorPrime = primes[0];
  return {
    primes,
    ordinalOfFirstPrime: estimatePrimeOrdinal(anchorPrime),
    ordinalIsEstimate: true,
  };
}

/**
 * Once 2 is in the buffer we know exactly which prime each one is, so throw
 * the estimate away and count from 2.
 */
function numberExactlyIfBufferContainsTwo(batches: Batch[]): Batch[] {
  const bufferContainsTwo = batches[0]?.primes[0] === 2;
  if (!bufferContainsTwo) return batches;

  let ordinal = 1;
  return batches.map((batch) => {
    const exactlyNumbered = { ...batch, ordinalOfFirstPrime: ordinal, ordinalIsEstimate: false };
    ordinal += batch.primes.length;
    return exactlyNumbered;
  });
}
