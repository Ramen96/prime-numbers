// Whether this browser's visitor lets proofs use the GPU (CLAUDE.md, step 11d),
// kept in localStorage. Until step 11e adds the switch (and turns it on by
// default, with the site's copy), it's off unless stored as "on".

export const GPU_PREFERENCE_KEY = "everyPrimeNumber.gpu";

export function gpuPreferred(): boolean {
  try {
    return window.localStorage.getItem(GPU_PREFERENCE_KEY) === "on";
  } catch {
    return false; // storage blocked: the default
  }
}
