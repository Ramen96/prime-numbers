// Where the GPU strips curve orders, and how deep (CLAUDE.md, step 11d): a rule
// of the node's size, from measurements, not a controller. Each step of a proof
// is a node, a number a few digits smaller than the one before, so one chain
// passes through every size below its start: a 200-digit proof also has 150-,
// 100- and 50-digit nodes, and each is stripped by the rule for its own size.
//
// Measured on Apple Metal 3 (M1: 249 /is-prime proofs on one thread, timed per
// 25-digit band of node size; then the list on 9 threads, with the GPU in its
// own worker):
// - Below 75 digits the CPU wins: for a small node stripping is a small part of
//   the work, and a strip call costs more than it saves (one thread, the GPU took
//   2.6× as long at 25–49 digits and 1.2× at 50–74). So those stay on the CPU.
// - From 75 digits the GPU wins, because it can strip much deeper than the CPU
//   can afford, and deeper stripping cuts the number of steps: about 1.3× at
//   75–99 digits, 1.1–3.7× in every band from 100.
// - The best depth was 10^6 to about 150 digits and 10^7 from there; 3 × 10^7
//   and 10^8 cost more GPU time than they saved.
// - A proof on its own (the checker, /random-prime) gains less than the list:
//   while a node waits for its batch (about 2 ms a strip call, the first 7 ms),
//   nothing else runs on its thread, whereas in the list the thread's second
//   prover works meanwhile (proofSlots.ts). Timed on /is-prime as a visitor sees
//   it (production build, a fresh page per proof, 12 primes a size, GPU against
//   CPU): 100 digits 5–8% slower, 110 digits 8% slower, 125 digits 2% faster,
//   135 digits 5% faster, 150 digits 16% faster, 200 and 300 digits 1.3× and
//   1.5×. So a lone proof uses the GPU only from 135 digits; below that it
//   doesn't touch the GPU at all.

/** What a request proves: the list's primes, or one number on its own (the checker, /random-prime). */
export type ProofWork = { kind: "list" } | { kind: "lone"; bits: number };

/** Numbers below this many bits (246 bits, 75 digits) strip on the CPU. */
export const GPU_STRIPPING_FROM_BITS = 246;

/** A lone proof of a number below this many bits (446 bits, 135 digits) doesn't use the GPU. */
export const LONE_GPU_FROM_BITS = 446;

/**
 * Whether the GPU strips for this work at all. The list always may, whatever the
 * size of its numbers (the node rule then keeps small nodes on the CPU); a lone
 * proof only from LONE_GPU_FROM_BITS. Anything that doesn't say it's lone is the list.
 */
export function gpuStripsFor(work: ProofWork): boolean {
  return work.kind === "list" || work.bits >= LONE_GPU_FROM_BITS;
}

/** Orders of this many limbs (481 bits, about 145 digits) or more are stripped to 10^7. */
export const DEEPEST_FROM_LIMBS = 16;

export const SHALLOW_GPU_DEPTH = 1_000_000;
export const DEEP_GPU_DEPTH = 10_000_000;

/**
 * The largest prime the GPU strips orders of `limbs` limbs with. Never shallower
 * than the CPU's own bound (10^5, or 10^6 from 830 bits: wasm/ecpp_prover.c).
 * This only decides speed: an order with a larger factor is just skipped for
 * another curve.
 */
export function gpuStripDepth(limbs: number): number {
  return limbs >= DEEPEST_FROM_LIMBS ? DEEP_GPU_DEPTH : SHALLOW_GPU_DEPTH;
}
