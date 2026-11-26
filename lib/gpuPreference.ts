// Whether this browser's visitor lets proofs use the GPU (CLAUDE.md, step 11e),
// kept in localStorage: on unless switched off (the home page's switch), except in
// Firefox, where it starts off. On only lets the GPU help where the rule says it
// pays (lib/primes/stripDepth.ts), and only where WebGPU works; off means the CPU
// does everything.

import { useSyncExternalStore } from "react";
import { requestHardwareAdapter } from "./gpuAdapter.ts";

export const GPU_PREFERENCE_KEY = "everyPrimeNumber.gpu";

/**
 * Firefox, by its user agent: there, with the GPU on, proofs were seen to hang
 * (the GPU's answers never came back, with no error), so the switch starts off
 * until that's understood. It can still be turned on; a call that doesn't come
 * back then turns it off for the session (GPU_CALL_TIMEOUT_MS). Firefox on iOS
 * (“FxiOS”) runs on WebKit, so it isn't counted.
 */
export function startsWithGpuOff(userAgent: string): boolean {
  return /\bFirefox\/\d/.test(userAgent);
}

/** The choice made on this page, which wins over storage that couldn't keep it. */
let sessionChoice: boolean | null = null;
const listeners = new Set<() => void>();

/** Without a choice stored: on, except where the switch starts off. */
function gpuPreferredByDefault(): boolean {
  return !startsWithGpuOff(navigator.userAgent);
}

export function gpuPreferred(): boolean {
  if (sessionChoice !== null) return sessionChoice;
  try {
    const stored = window.localStorage.getItem(GPU_PREFERENCE_KEY);
    return stored === null ? gpuPreferredByDefault() : stored !== "off";
  } catch {
    return gpuPreferredByDefault(); // storage blocked: the default
  }
}

/** Remembers the choice (if storage allows) and tells everything showing it. */
export function setGpuPreferred(on: boolean): void {
  try {
    window.localStorage.setItem(GPU_PREFERENCE_KEY, on ? "on" : "off");
  } catch {
    // storage blocked or full: it applies for this page only
  }
  sessionChoice = on;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== GPU_PREFERENCE_KEY) return;
    sessionChoice = null; // another tab switched it: storage has the latest
    listener();
  };
  window.addEventListener("storage", onStorage); // another tab switched it
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The preference, for a component: on in the server's HTML, then whatever this browser stored. */
export function useGpuPreference(): boolean {
  return useSyncExternalStore(subscribe, gpuPreferred, () => true);
}

let webGpuCheck: Promise<boolean> | null = null;

/**
 * Whether this browser can give the page a hardware WebGPU adapter: asked once.
 * A software one counts as none (lib/gpuAdapter.ts). The workers ask for their
 * own, so they may still find none (then they say so, and the CPU does everything).
 */
export function webGpuAvailable(): Promise<boolean> {
  webGpuCheck ??= (async () => {
    try {
      return (await requestHardwareAdapter(navigator.gpu)) !== null;
    } catch {
      return false;
    }
  })();
  return webGpuCheck;
}
