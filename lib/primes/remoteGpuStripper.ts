// The prime worker's side of GPU stripping: an OrderStripper whose calls go to
// the GPU worker (gpuStrippingWorker.ts), one message out and one back, so its
// answers arrive between runs at once instead of a few awaits later. ProofSlots
// treats it like any stripper: every factor it reports is checked, a spot check
// looks for missed ones, and any failure (a GPU error, the worker stopping, or a
// call that doesn't come back in time) drops it, with everything going on on the CPU.

import { GpuStrippingError, type StripHit } from "./gpuStripping.ts";
import type { DisposableStripper } from "./gpuStrippingControl.ts";
import type { GpuStrippingReply, GpuStrippingRequest } from "./gpuStrippingWorker.ts";
import { GPU_STRIPPING_WORKER_NAME } from "./workerNames.ts";

/** What RemoteGpuStripper needs of the GPU worker: a Worker, or a stand-in over a MessageChannel in tests. */
export interface GpuStrippingEndpoint {
  postMessage(request: GpuStrippingRequest): void;
  onmessage: ((event: MessageEvent<GpuStrippingReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

export function startGpuStrippingWorker(): GpuStrippingEndpoint {
  return new Worker(new URL("./gpuStripping.worker.ts", import.meta.url), { type: "module", name: GPU_STRIPPING_WORKER_NAME });
}

/** Said when the GPU worker stops (it failed to load or crashed): the stripper is dropped. */
export const GPU_WORKER_STOPPED_MESSAGE = "The GPU worker stopped.";

/**
 * How long a strip call may take before the GPU is given up on. In Firefox, calls
 * were seen never to come back, and a single proof, waiting on its call, froze
 * with no error. The longest calls measured take about 70 ms on an Apple M4 (the
 * list near 10^200) and about 15 times that on SwiftShader, a software GPU, so a
 * call this late isn't coming. The proof goes on on the CPU, and the GPU stays
 * off for the session (GpuStrippingControl, as after any failure).
 */
export const GPU_CALL_TIMEOUT_MS = 5_000;

/** Said when a call doesn't come back within GPU_CALL_TIMEOUT_MS. */
export const GPU_CALL_TIMED_OUT_MESSAGE = "The GPU didn't answer in time.";

export class RemoteGpuStripper implements DisposableStripper {
  readonly #endpoint: GpuStrippingEndpoint;
  readonly #callTimeoutMs: number;
  #nextCall = 1;
  /** Calls on their way, by number. */
  readonly #waiting = new Map<number, { resolve: (hits: StripHit[]) => void; reject: (error: unknown) => void }>();
  /** Why every call fails from now on, once the worker stopped or this was destroyed. */
  #stopped: string | null = null;

  private constructor(endpoint: GpuStrippingEndpoint, callTimeoutMs: number) {
    this.#endpoint = endpoint;
    this.#callTimeoutMs = callTimeoutMs;
    endpoint.onmessage = (event) => {
      const reply = event.data;
      if (reply.type === "ready") return;
      const waiting = this.#waiting.get(reply.call);
      if (!waiting) return; // called off: its answer doesn't matter
      this.#waiting.delete(reply.call);
      if (reply.type === "stripped") waiting.resolve(reply.hits);
      else waiting.reject(new GpuStrippingError(reply.message));
    };
    endpoint.onerror = () => this.#stop(GPU_WORKER_STOPPED_MESSAGE);
  }

  /** Starts the GPU worker; null (and the worker ended) if it has no GPU or fails to start. */
  static async create(
    endpoint: GpuStrippingEndpoint = startGpuStrippingWorker(),
    { callTimeoutMs = GPU_CALL_TIMEOUT_MS } = {},
  ): Promise<RemoteGpuStripper | null> {
    const available = await new Promise<boolean>((resolve) => {
      endpoint.onmessage = (event) => {
        if (event.data.type === "ready") resolve(event.data.available);
      };
      endpoint.onerror = () => resolve(false);
    });
    if (!available) {
      endpoint.onmessage = endpoint.onerror = null;
      endpoint.terminate();
      return null;
    }
    return new RemoteGpuStripper(endpoint, callTimeoutMs);
  }

  strip(orders: readonly Uint32Array[], largestPrime: number, signal?: AbortSignal): Promise<StripHit[]> {
    if (this.#stopped !== null) return Promise.reject(new GpuStrippingError(this.#stopped));
    if (signal?.aborted) return Promise.reject(signal.reason);
    const call = this.#nextCall++;
    return new Promise<StripHit[]>((resolve, reject) => {
      // too late: every call fails, and ProofSlots drops the stripper (GPU_CALL_TIMEOUT_MS)
      const deadline = setTimeout(() => this.#waiting.has(call) && this.#stop(GPU_CALL_TIMED_OUT_MESSAGE), this.#callTimeoutMs);
      const settle = <T,>(finish: (value: T) => void) => (value: T) => {
        clearTimeout(deadline);
        finish(value);
      };
      this.#waiting.set(call, { resolve: settle(resolve), reject: settle(reject) });
      signal?.addEventListener(
        "abort",
        () => {
          if (!this.#waiting.delete(call)) return;
          clearTimeout(deadline);
          reject(signal.reason);
          this.#endpoint.postMessage({ type: "abort", call });
        },
        { once: true },
      );
      // copied, not transferred: ProofSlots checks each answer against its orders
      this.#endpoint.postMessage({ type: "strip", call, orders: [...orders], largestPrime });
    });
  }

  /** Ends the GPU worker (and with it the device); calls on their way fail. */
  destroy(): void {
    this.#stop("The GPU stripper was destroyed.");
    this.#endpoint.onmessage = this.#endpoint.onerror = null;
    this.#endpoint.terminate();
  }

  #stop(reason: string): void {
    if (this.#stopped !== null) return;
    this.#stopped = reason;
    for (const { reject } of this.#waiting.values()) reject(new GpuStrippingError(reason));
    this.#waiting.clear();
  }
}
