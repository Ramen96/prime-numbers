// The GPU worker's side of GPU stripping (CLAUDE.md, step 11d): it owns the
// GpuStripper and answers strip calls sent by the prime worker's
// RemoteGpuStripper (remoteGpuStripper.ts). The shell is gpuStripping.worker.ts;
// the logic is here so tests can serve it over a MessageChannel in Node.
//
// Why a worker of its own: a strip call awaits the GPU several times (error
// scopes, two mapAsync). On the prime worker's thread, which is blocked in
// proof_slots_run, each await could only resolve between runs, so a call took
// 8 to 13 runs whatever the GPU's work. Here they resolve while the threads run,
// and the prime worker gets one message per call (step 11d measured a call at
// about 2 runs, and the list 1.4× faster at 10^100).

import type { StripHit } from "./gpuStripping.ts";
import type { DisposableStripper } from "./gpuStrippingControl.ts";

/** From the prime worker. `call` numbers each strip call, so answers and aborts find theirs. */
export type GpuStrippingRequest =
  | { type: "strip"; call: number; orders: Uint32Array[]; largestPrime: number }
  | { type: "abort"; call: number };

/** To the prime worker: first `ready` (once: whether there's a GPU), then one answer per strip call. */
export type GpuStrippingReply =
  | { type: "ready"; available: boolean }
  | { type: "stripped"; call: number; hits: StripHit[] }
  | { type: "failed"; call: number; message: string };

/** What serveGpuStripping needs of its side of the channel: the worker's own scope, or a MessagePort. */
export interface GpuStrippingScope {
  postMessage(reply: GpuStrippingReply): void;
  onmessage: ((event: MessageEvent<GpuStrippingRequest>) => void) | null;
}

/**
 * Makes the stripper at once (`ready` says whether there is one; one that can't
 * be made counts as none), then strips each call as it comes. Calls are taken in
 * turn by the stripper itself (GpuStripper queues them); an abort is passed on
 * to the call's signal, and its answer, if any, is ignored by the other side.
 */
export function serveGpuStripping(scope: GpuStrippingScope, create: () => Promise<DisposableStripper | null>): void {
  const stripperReady = create().catch(() => null);
  void stripperReady.then((stripper) => scope.postMessage({ type: "ready", available: stripper !== null }));
  const aborts = new Map<number, AbortController>();

  scope.onmessage = (event) => {
    const request = event.data;
    if (request.type === "abort") {
      aborts.get(request.call)?.abort();
      return;
    }
    const abort = new AbortController();
    aborts.set(request.call, abort);
    void (async () => {
      try {
        const stripper = await stripperReady;
        if (!stripper) throw new Error("There’s no GPU to strip with.");
        const hits = await stripper.strip(request.orders, request.largestPrime, abort.signal);
        scope.postMessage({ type: "stripped", call: request.call, hits });
      } catch (error) {
        scope.postMessage({ type: "failed", call: request.call, message: error instanceof Error ? error.message : String(error) });
      } finally {
        aborts.delete(request.call);
      }
    })();
  };
}
