// The interactive sieve of Eratosthenes on /how-it-works: what every number
// looks like after a given number of steps, and what the caption says. Plain
// numbers, not BigInt: the range is fixed in code, 1 to 120.

import { andList, shortList } from "./listText.ts";
import { sieveAnimation } from "./sieveAnimation.ts";

/** Twelve rows of ten, ending just below 11² = 121, so the stopping rule shows itself. */
export const SIEVE_DEMO_LIMIT = 120;

const { cells, passes, survivors } = sieveAnimation(2, SIEVE_DEMO_LIMIT);

/** One step per sieving prime (2, 3, 5, 7), then one to say everything left is prime. */
export const SIEVE_DEMO_STEPS = passes.length + 1;
/** The sieving primes, in order: step n (from 1) uses passes[n − 1]. */
export const SIEVE_DEMO_PRIMES: readonly number[] = passes;
/** What's left at the end: the primes up to 120. */
export const SIEVE_DEMO_SURVIVORS: readonly number[] = survivors;

export type SieveDemoCellState =
  | "not-prime" // 1, which is neither prime nor crossed off
  | "standing" // not reached yet
  | "crossed" // crossed off by `crossedOutBy`
  | "sieving-prime" // one of 2, 3, 5, 7, once its step has come
  | "prime"; // left standing once the sieve is done

export interface SieveDemoCell {
  value: number;
  state: SieveDemoCellState;
  /** The prime that crosses it off (its smallest prime factor), or null. */
  crossedOutBy: number | null;
  /** Which sieving prime's colour it takes (its index in SIEVE_DEMO_PRIMES), or null. */
  colorIndex: number | null;
  /** True for the numbers crossed off in this very step, which animate in order. */
  justCrossed: boolean;
  /** Its place among the numbers crossed off in this step (0 first), for the animation's stagger. */
  orderInStep: number;
}

/** Every number from 1 to 120 after `step` steps (0 to SIEVE_DEMO_STEPS). */
export function sieveDemoCells(step: number): SieveDemoCell[] {
  const done = step >= SIEVE_DEMO_STEPS;
  const orderInStep = new Map<number, number>();
  return [
    { value: 1, state: "not-prime", crossedOutBy: null, colorIndex: null, justCrossed: false, orderInStep: 0 },
    ...cells.map((cell): SieveDemoCell => {
      const sievingIndex = passes.indexOf(cell.value);
      if (cell.crossedOutBy !== null && cell.pass < step) {
        const justCrossed = cell.pass === step - 1;
        const order = orderInStep.get(cell.crossedOutBy) ?? 0;
        orderInStep.set(cell.crossedOutBy, order + 1);
        return {
          value: cell.value,
          state: "crossed",
          crossedOutBy: cell.crossedOutBy,
          colorIndex: cell.pass,
          justCrossed,
          orderInStep: order,
        };
      }
      if (sievingIndex !== -1 && sievingIndex < step)
        return { value: cell.value, state: "sieving-prime", crossedOutBy: null, colorIndex: sievingIndex, justCrossed: false, orderInStep: 0 };
      return {
        value: cell.value,
        state: done && cell.crossedOutBy === null ? "prime" : "standing",
        crossedOutBy: null,
        colorIndex: null,
        justCrossed: false,
        orderInStep: 0,
      };
    }),
  ];
}

/** What the caption says after `step` steps. */
export function sieveDemoCaption(step: number): string {
  if (step <= 0)
    return `Every number from 2 to ${SIEVE_DEMO_LIMIT}, none crossed off yet (1 isn’t prime). Press “Next step” to start with 2.`;
  if (step >= SIEVE_DEMO_STEPS) {
    // the next prime after the last sieving one: its square is past the limit
    const next = survivors.find((prime) => prime > passes[passes.length - 1])!;
    return `${next}² = ${next * next} is past ${SIEVE_DEMO_LIMIT}, so everything left is prime: ${survivors.length} primes.`;
  }
  const prime = passes[step - 1];
  const square = prime * prime;
  const crossedNow = cells.filter((cell) => cell.crossedOutBy === prime).map((cell) => cell.value);
  const count = `${crossedNow.length} ${crossedNow.length === 1 ? "number" : "numbers"}`;
  let caption = `${prime} is the next number not crossed off, so it’s prime. Crossing off its multiples from ${prime}² = ${square}`;
  const alreadyCrossed = cells.filter(
    (cell) => cell.value >= square && cell.value % prime === 0 && cell.crossedOutBy !== prime,
  );
  if (alreadyCrossed.length === 0) return `${caption}: ${shortList(crossedNow)} (${count}).`;
  caption += ` that are still standing: ${shortList(crossedNow)} (${count}).`;
  const examples = alreadyCrossed.slice(0, 2).map((cell) => cell.value);
  const by = [...new Set(alreadyCrossed.map((cell) => cell.crossedOutBy!))].sort((first, second) => first - second);
  return `${caption} The others, like ${andList(examples)}, were already crossed off by ${andList(by)}.`;
}
