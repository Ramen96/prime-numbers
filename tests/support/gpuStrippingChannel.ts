// The GPU worker served over a MessageChannel in Node, so tests can drive
// RemoteGpuStripper and serveGpuStripping together with a stand-in stripper:
// every request and answer is structured-cloned, as between real workers.

import { MessageChannel } from "node:worker_threads";
import type { DisposableStripper } from "../../lib/primes/gpuStrippingControl.ts";
import { serveGpuStripping, type GpuStrippingScope } from "../../lib/primes/gpuStrippingWorker.ts";
import type { GpuStrippingEndpoint } from "../../lib/primes/remoteGpuStripper.ts";

const open = new Set<{ close(): void }>();

/** Closes every channel still open, so a failed test doesn't keep Node running (call it in afterEach). */
export function closeGpuStrippingChannels(): void {
  for (const port of open) port.close();
  open.clear();
}

export function gpuStrippingChannel(create: () => Promise<DisposableStripper | null>) {
  const { port1, port2 } = new MessageChannel();
  open.add(port1);
  serveGpuStripping(port2 as unknown as GpuStrippingScope, create);
  const record = { terminated: false };
  const endpoint: GpuStrippingEndpoint = {
    postMessage: (request) => port1.postMessage(request),
    onmessage: null,
    onerror: null,
    terminate: () => {
      record.terminated = true;
      port1.close();
    },
  };
  port1.on("message", (data) => endpoint.onmessage?.({ data } as MessageEvent));
  /** As if the worker crashed. */
  const crash = () => endpoint.onerror?.({} as ErrorEvent);
  return { endpoint, record, crash };
}
