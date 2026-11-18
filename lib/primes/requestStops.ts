// Which of the prime worker's requests should stop proving (primes.worker.ts).
//
// The worker runs one batch request at a time, but its message handler still
// runs between proving runs (ProofSlots.proveInOrder yields to it), so it can
// hear about a stop while a batch is being proven. A request stops if the page
// paused it (Stop), or if a newer request is waiting behind it: the page only
// sends one while another is unfinished when it has given up on that one (a jump).

export class RequestStops {
  /** Every request up to this id was paused. Ids only grow, so one number covers them all. */
  #pausedUpToId = 0;
  /** Requests that have arrived but not yet started. */
  #waiting = 0;

  /** A batch request arrived; it waits until those before it are done. */
  arrived(): void {
    this.#waiting++;
  }

  /** A waiting request starts. */
  started(): void {
    this.#waiting = Math.max(0, this.#waiting - 1);
  }

  /** The page paused request `id` (and so any before it). */
  paused(id: number): void {
    this.#pausedUpToId = Math.max(this.#pausedUpToId, id);
  }

  /** Whether the running request `id` should stop: paused, or replaced by a newer one waiting. */
  shouldStop(id: number): boolean {
    return id <= this.#pausedUpToId || this.#waiting > 0;
  }
}

/**
 * Waits for the event loop to go round once, so messages that arrived during
 * a proving run are handled. A MessageChannel, not setTimeout: nested timers
 * are clamped to at least 4 ms, which near a(13) is longer than a proof.
 */
export function yieldToMessages(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
