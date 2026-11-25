/// <reference lib="webworker" />
// The GPU worker, started inside the prime worker (or the checker's) the first
// time a request asks for the GPU: it owns the WebGPU device and strips curve
// orders for the proof slots. Terminating the prime worker ends it too. The
// logic is in gpuStrippingWorker.ts.

import { GpuStripper } from "./gpuStripping.ts";
import { serveGpuStripping } from "./gpuStrippingWorker.ts";

declare const self: DedicatedWorkerGlobalScope;

serveGpuStripping(self, () => GpuStripper.create());
