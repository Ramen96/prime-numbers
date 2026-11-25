// What the home page's GPU row says (CLAUDE.md, step 11e): the visitor's switch,
// whether this browser has WebGPU, and what the worker last reported.

import type { GpuStrippingStatus } from "./primes/protocol.ts";

export interface GpuRow {
  text: string;
  /** Whether the switch shows on. */
  checked: boolean;
  /** No WebGPU here (or not known yet): the switch can't be used. */
  disabled: boolean;
}

/**
 * `available` is null until the page has asked for an adapter. The worker's
 * word wins over the page's: it may find no adapter where the page did, and once
 * the GPU failed or gave a wrong answer it stays on the CPU until the page reloads.
 */
export function describeGpuRow(preferred: boolean, available: boolean | null, status: GpuStrippingStatus | null): GpuRow {
  if (available === null) return { text: "—", checked: false, disabled: true };
  if (!available || status?.state === "unavailable") return { text: "not available here", checked: false, disabled: true };
  if (status?.state === "failed") {
    const text = status.failure.kind === "error" ? "stopped after an error" : "stopped after a wrong answer";
    return { text, checked: preferred, disabled: false };
  }
  if (!preferred) return { text: "off, CPU only", checked: false, disabled: false };
  if (status?.state === "gpu") return { text: "on, helping", checked: true, disabled: false };
  return { text: "on, used from 75 digits", checked: true, disabled: false };
}
