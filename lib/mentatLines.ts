// A Dune easter egg: now and then, a Mentat line instead of the counter's
// "—" while calculating, or under the memory-limit notice. Purely cosmetic:
// nothing here affects calculating, timing or stopping.
//
// The lines and the odds are all here, so they're easy to edit.

/** The chance of a line, each time one could appear. */
export const MENTAT_CHANCE = 0.2;

/** In place of the counter's "—" while calculating, before the first rate is measured. */
export const CALCULATING_LINES = [
  "A Mentat would have this by now.",
  "A Mentat would do this in his head.",
  "Somewhere, a Mentat is already finished.",
  "Thinking machines are still allowed here.",
  "Calculating without a Mentat. Bold.",
  "A Mentat wouldn’t need a speed counter.",
  "A Mentat would ask for more sapho juice.",
  "This is why Mentats were invented.",
  "The Butlerian Jihad warned you about this.",
  "A Mentat is judging your CPU.",
] as const;

/** A second line under the memory-limit notice. */
export const MEMORY_LIMIT_LINES = [
  "A Mentat wouldn’t have this problem.",
  "A Mentat’s memory has no limit. Yours does.",
  "Out of memory. A Mentat never is.",
  "Even a thinking machine has limits.",
  "A Mentat would remember every base prime.",
] as const;

/** A random number in [0, 1), like Math.random. */
export type RandomSource = () => number;

/**
 * Where the randomness comes from: Math.random, unless an end-to-end test
 * has set `window.everyPrimeNumberMentatRandom` before the page loaded.
 * (Unit tests pass their own source to maybeMentatLine instead.)
 */
export function mentatRandom(): number {
  const override = (globalThis as { everyPrimeNumberMentatRandom?: RandomSource }).everyPrimeNumberMentatRandom;
  return (override ?? Math.random)();
}

/**
 * With probability MENTAT_CHANCE, a line picked at random from `lines`;
 * otherwise null. Draws once for the chance and, only if it hits, once more
 * for which line.
 */
export function maybeMentatLine(lines: readonly string[], random: RandomSource = mentatRandom): string | null {
  if (lines.length === 0 || !(random() < MENTAT_CHANCE)) return null;
  const index = Math.min(lines.length - 1, Math.floor(random() * lines.length));
  return lines[index];
}
