// The interactive segmented sieve on /how-it-works: a window of 20 numbers that
// slides along from 100, crossed off one base prime at a time, the way the site's
// worker sieves (wasm/sieve.c): each base prime jumps straight to its first
// multiple in the window and marks every multiple from there, without checking
// whether a smaller prime already did. Plain numbers, not BigInt: the windows
// start at 100 and move 20 at a time, a click each.

import { andList, shortList } from "./listText.ts";

/** Numbers in a window: the worked example's 100 to 119. */
export const SEGMENT_DEMO_WINDOW_SIZE = 20;
/** Where the first window starts. */
export const SEGMENT_DEMO_FIRST_START = 100;

/** Primes up to `limit`, by trial division (the limit is small). */
function primesUpTo(limit: number): number[] {
  const primes: number[] = [];
  for (let candidate = 2; candidate <= limit; candidate++)
    if (primes.every((prime) => candidate % prime !== 0)) primes.push(candidate);
  return primes;
}

/** One base prime's pass over a window. */
export interface SegmentPass {
  prime: number;
  /** Which colour it takes: its place among all primes (2 is 0, 3 is 1, …). */
  colorIndex: number;
  /** `low` mod `prime`: how far the window's start is past a multiple. */
  remainder: number;
  /** Where it would first land in the window from the remainder: low + (prime − remainder) mod prime. */
  fromRemainder: number;
  /** Where it really starts: the later of that and prime², below which smaller primes have it covered. */
  firstMultiple: number;
  /** The multiples it marks, from firstMultiple to the window's end (none if it starts past it). */
  marks: number[];
}

export interface SegmentWindow {
  index: number;
  /** The first number in the window. */
  low: number;
  /** One past the last: the window is low to high − 1. */
  high: number;
  /** Every prime p with p² ≤ high − 1: the only ones that can divide a composite in the window. */
  basePrimes: number[];
  /** Base primes new in this window (their squares are in it). */
  joined: number[];
  passes: SegmentPass[];
  /** What's left once every pass is done: the primes in the window. */
  survivors: number[];
  /** Next step, once per base prime, then once to show what's left. */
  steps: number;
}

/** The window `index` windows along from the first (0 is 100 to 119). */
export function segmentWindow(index: number): SegmentWindow {
  const low = SEGMENT_DEMO_FIRST_START + index * SEGMENT_DEMO_WINDOW_SIZE;
  const high = low + SEGMENT_DEMO_WINDOW_SIZE;
  const basePrimes = primesUpTo(Math.floor(Math.sqrt(high - 1)));
  const joined = basePrimes.filter((prime) => prime * prime >= low);
  const passes = basePrimes.map((prime, colorIndex): SegmentPass => {
    const remainder = low % prime;
    const fromRemainder = low + ((prime - remainder) % prime);
    const firstMultiple = Math.max(fromRemainder, prime * prime);
    const marks: number[] = [];
    for (let multiple = firstMultiple; multiple < high; multiple += prime) marks.push(multiple);
    return { prime, colorIndex, remainder, fromRemainder, firstMultiple, marks };
  });
  const marked = new Set(passes.flatMap((pass) => pass.marks));
  const survivors: number[] = [];
  for (let value = low; value < high; value++) if (!marked.has(value)) survivors.push(value);
  return { index, low, high, basePrimes, joined, passes, survivors, steps: passes.length + 1 };
}

export type SegmentCellState = "standing" | "crossed" | "prime";

export interface SegmentCell {
  value: number;
  state: SegmentCellState;
  /** Every pass that has marked it so far, in order: one strike each. */
  crossedBy: { prime: number; colorIndex: number }[];
  /** Marked in this very step (by `step`'s prime), and its place among those marks, for the stagger. */
  justCrossed: boolean;
  orderInStep: number;
}

/** The window's numbers after `step` steps (0 to window.steps). */
export function segmentCells(window: SegmentWindow, step: number): SegmentCell[] {
  const done = step >= window.steps;
  const cells: SegmentCell[] = [];
  for (let value = window.low; value < window.high; value++) {
    const crossedBy = window.passes
      .slice(0, Math.min(step, window.passes.length))
      .filter((pass) => pass.marks.includes(value))
      .map(({ prime, colorIndex }) => ({ prime, colorIndex }));
    const current = step >= 1 && step <= window.passes.length ? window.passes[step - 1] : null;
    const orderInStep = current ? current.marks.indexOf(value) : -1;
    cells.push({
      value,
      state: crossedBy.length > 0 ? "crossed" : done ? "prime" : "standing",
      crossedBy,
      justCrossed: orderInStep !== -1,
      orderInStep: Math.max(orderInStep, 0),
    });
  }
  return cells;
}

/** What the caption says at `step` of a window. */
export function segmentCaption(window: SegmentWindow, step: number): string {
  const { low, high, basePrimes, joined, passes, survivors } = window;
  const last = high - 1;
  if (step <= 0) {
    if (window.index === 0) {
      const next = primesUpTo(Math.ceil(Math.sqrt(high)) + 10).find((prime) => prime * prime > last)!;
      return `The numbers ${low} to ${last}. √${last} is just under ${next}, so the base primes are ${andList(basePrimes)}. Press “Next step” to start with ${basePrimes[0]}.`;
    }
    const moved = `The numbers ${low} to ${last}: the window has moved, but it’s still ${SEGMENT_DEMO_WINDOW_SIZE} numbers.`;
    if (joined.length > 0) {
      const squares = andList(joined.map((prime) => prime * prime));
      return `${moved} ${joined.map((prime) => `${prime}²`).join(" and ")} = ${squares} ${joined.length === 1 ? "is" : "are"} inside it, so ${andList(joined)} ${joined.length === 1 ? "joins" : "join"} the base primes: ${andList(basePrimes)}.`;
    }
    const nextPrime = primesUpTo(Math.ceil(Math.sqrt(high)) + 50).find((prime) => !basePrimes.includes(prime) && prime > basePrimes[basePrimes.length - 1])!;
    return `${moved} The base primes are still ${andList(basePrimes)}: ${nextPrime}² = ${nextPrime * nextPrime} is past it.`;
  }
  if (step > passes.length) {
    if (survivors.length === 0) return "Nothing’s left: there are no primes in this window.";
    return `What’s left is prime: ${andList(survivors)}.`;
  }
  const pass = passes[step - 1];
  const { prime, remainder, fromRemainder, firstMultiple, marks } = pass;
  const landing =
    remainder === 0
      ? `${low} mod ${prime} is 0, so ${low} itself is its first multiple here`
      : `${low} mod ${prime} is ${remainder}, so its first multiple here is ${fromRemainder}`;
  const start = firstMultiple > fromRemainder ? `${landing}, but it starts at ${prime}² = ${firstMultiple}` : landing;
  if (marks.length === 0) return `${prime}: ${start}, past the window: nothing to cross off.`;
  const already = marks.filter((value) => passes.slice(0, step - 1).some((earlier) => earlier.marks.includes(value)));
  const count = `${marks.length} ${marks.length === 1 ? "number" : "numbers"}`;
  let caption = `${prime}: ${start}. Crossing off ${shortList(marks)} (${count}).`;
  if (already.length > 0)
    caption += ` ${already.length > 4 ? `${already.slice(0, 3).join(", ")} and ${already.length - 3} more` : andList(already)} ${already.length === 1 ? "was" : "were"} already crossed off, and ${already.length === 1 ? "is" : "are"} marked again: the sieve doesn’t check.`;
  return caption;
}
