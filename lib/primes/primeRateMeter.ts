// Primes-per-second, measured over a window of recent batches rather than
// one batch at a time.
//
// Why a window: browsers round performance.now() (to 0.1 ms or coarser, and
// much finer only when the page is cross-origin isolated). Early batches
// finish faster than one rounding step, so a single batch usually measures
// 0 ms, or one whole step. Dividing by that turns tiny rounding errors into
// wild swings. Summing many batches averages the rounding out: across the
// window, the rounded durations add up to almost exactly the true total.

export interface BatchTiming {
  primeCount: number;
  /** As measured by the worker, so possibly 0 for a fast batch. */
  measuredDurationMs: number;
}

/** Recent batch timings, oldest first. Treat as immutable. */
export type RateWindow = readonly BatchTiming[];

export const EMPTY_RATE_WINDOW: RateWindow = [];

/**
 * Keep at least this much measured time in the window, so the timer's
 * rounding is small compared to the total.
 */
export const MIN_WINDOW_DURATION_MS = 50;

/**
 * Never keep more than this many batches, even if they don't add up to
 * MIN_WINDOW_DURATION_MS. Fast batches can take thousands of batches to reach
 * 50 ms, and a window that long would barely react when the numbers get bigger.
 */
export const MAX_WINDOW_BATCHES = 32;

/**
 * Adds a batch, then drops the oldest batches the window no longer needs:
 * any beyond MAX_WINDOW_BATCHES, and any whose removal would still leave at
 * least MIN_WINDOW_DURATION_MS of measured time.
 */
export function recordBatch(window: RateWindow, batch: BatchTiming): RateWindow {
  const updatedWindow = [...window, batch];
  let windowDurationMs = totalDurationMs(updatedWindow);
  let oldestKept = 0;

  while (updatedWindow.length - oldestKept > 1) {
    const oldest = updatedWindow[oldestKept];
    const tooManyBatches = updatedWindow.length - oldestKept > MAX_WINDOW_BATCHES;
    const enoughTimeWithoutIt =
      windowDurationMs - oldest.measuredDurationMs >= MIN_WINDOW_DURATION_MS;
    if (!tooManyBatches && !enoughTimeWithoutIt) break;

    windowDurationMs -= oldest.measuredDurationMs;
    oldestKept++;
  }

  return updatedWindow.slice(oldestKept);
}

/**
 * Total primes ÷ total measured time across the window. Batches that measured
 * 0 ms count too: their primes are in the total, and so is their 0 ms.
 * Returns null when there's no measured time yet, rather than inventing a number.
 */
export function measurePrimesPerSecond(window: RateWindow): number | null {
  const windowDurationMs = totalDurationMs(window);
  if (windowDurationMs <= 0) return null;
  const totalPrimes = window.reduce((sum, batch) => sum + batch.primeCount, 0);
  return totalPrimes / (windowDurationMs / 1000);
}

function totalDurationMs(window: RateWindow): number {
  return window.reduce((sum, batch) => sum + batch.measuredDurationMs, 0);
}
