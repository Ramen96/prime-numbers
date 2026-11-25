// Whether this browser's visitor lets proofs use the GPU (CLAUDE.md, step 11e),
// kept in localStorage: on unless switched off (the home page's switch). On only
// lets the GPU help where the rule says it pays (lib/primes/stripDepth.ts), and
// only where WebGPU works; off means the CPU does everything.

import { useSyncExternalStore } from "react";

export const GPU_PREFERENCE_KEY = "everyPrimeNumber.gpu";

/** The choice made on this page, which wins over storage that couldn't keep it. */
let sessionChoice: boolean | null = null;
const listeners = new Set<() => void>();

export function gpuPreferred(): boolean {
  if (sessionChoice !== null) return sessionChoice;
  try {
    return window.localStorage.getItem(GPU_PREFERENCE_KEY) !== "off";
  } catch {
    return true; // storage blocked: the default
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
 * Whether this browser can give the page a WebGPU adapter: asked once. The
 * workers ask for their own, so they may still find none (then they say so,
 * and the CPU does everything).
 */
export function webGpuAvailable(): Promise<boolean> {
  webGpuCheck ??= (async () => {
    try {
      return (await navigator.gpu?.requestAdapter()) != null;
    } catch {
      return false;
    }
  })();
  return webGpuCheck;
}
