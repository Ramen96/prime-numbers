// The prime worker's side of GPU stripping: an OrderStripper whose calls go to
// the GPU worker (gpuStrippingWorker.ts), one message out and one back, so its
// answers arrive between runs at once instead of a few awaits later. ProofSlots
// treats it like any stripper: every factor it reports is checked, a spot check
// looks for missed ones, and any failure (a GPU error, or the worker stopping)
// drops it, with everything going on on the CPU.

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

export class RemoteGpuStripper implements DisposableStripper {
  readonly #endpoint: GpuStrippingEndpoint;
  #nextCall = 1;
  /** Calls on their way, by number. */
  readonly #waiting = new Map<number, { resolve: (hits: StripHit[]) => void; reject: (error: unknown) => void }>();
  /** Why every call fails from now on, once the worker stopped or this was destroyed. */
  #stopped: string | null = null;

  private constructor(endpoint: GpuStrippingEndpoint) {
    this.#endpoint = endpoint;
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
  static async create(endpoint: GpuStrippingEndpoint = startGpuStrippingWorker()): Promise<RemoteGpuStripper | null> {
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
    return new RemoteGpuStripper(endpoint);
  }

  strip(orders: readonly Uint32Array[], largestPrime: number, signal?: AbortSignal): Promise<StripHit[]> {
    if (this.#stopped !== null) return Promise.reject(new GpuStrippingError(this.#stopped));
    if (signal?.aborted) return Promise.reject(signal.reason);
    const call = this.#nextCall++;
    return new Promise<StripHit[]>((resolve, reject) => {
      this.#waiting.set(call, { resolve, reject });
      signal?.addEventListener(
        "abort",
        () => {
          if (!this.#waiting.delete(call)) return;
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
