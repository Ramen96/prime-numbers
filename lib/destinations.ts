// Places worth visiting in the list (CLAUDE.md, “After completion”, step 3b):
// listed on /fun-facts (“Places to visit in the list”), picked at random by
// “Take me somewhere interesting” on the home page, and named in the jump box's
// line when a jump lands on one. Where a place is a notable listed number, its
// line is that number's note (lib/listedNumbers.ts), so a fact lives in one place.

import { listedNumber } from "./listedNumbers.ts";

export interface Destination {
  /** Where the jump goes: the list starts at the first prime ≥ this. */
  value: bigint;
  /** How /fun-facts shows it: the number, or its formula when the number is long. */
  label: string;
  /** For the jump box's line: “Jumped to 1,000,003: the first prime after a million.” */
  name: string;
  /** The longer line on /fun-facts; empty for the hidden ones, which aren't listed there. */
  note: string;
  /** Every prime there is proven one at a time, so the first ones take seconds to a minute. Never picked at random. */
  slow: boolean;
  /** An easter egg: picked at random, but not listed on /fun-facts, so it stays a surprise. */
  hidden: boolean;
}

/** A listed number's note: the destination's line comes from there, so it must exist. */
function noteOf(value: bigint): string {
  const note = listedNumber(value)?.note;
  if (!note) throw new Error(`${value} has no note in lib/listedNumbers.ts`);
  return note;
}

const place = (value: bigint, label: string, name: string, note: string, slow = false): Destination => ({
  value,
  label,
  name,
  note,
  slow,
  hidden: false,
});
const hidden = (value: bigint): Destination => ({ value, label: "", name: "look closely", note: "", slow: false, hidden: true });

/** 2⁵³: past it, a JavaScript number can't hold every whole number (2⁵³ + 1 rounds to 2⁵³). */
const TWO_TO_THE_53 = 2n ** 53n;
/** The prime before the largest gap known below 2⁶⁴, 1,550 wide (also on /fun-facts, #prime-free-stretches). */
const RECORD_GAP_START = 18_361_375_334_787_046_697n;
/** a(13): from here on, every prime needs a certificate. */
const PROOFS_BEGIN = 3_317_044_064_679_887_385_961_981n;
const PI_38_DIGITS = 31_415_926_535_897_932_384_626_433_832_795_028_841n;

/** Every destination, in order. */
export const DESTINATIONS: readonly Destination[] = [
  hidden(359n),
  hidden(314_159n),
  place(1_000_003n, "1,000,003", "the first prime after a million", noteOf(1_000_003n)),
  place(8_675_309n, "8,675,309", "Jenny’s number, one of a pair of twin primes", noteOf(8_675_309n)),
  place(1_000_000_007n, "10⁹ + 7", "10⁹ + 7, the programmers’ favourite prime", noteOf(1_000_000_007n)),
  place(2n ** 31n - 1n, "2³¹ − 1", "2³¹ − 1, the largest signed 32-bit integer", noteOf(2n ** 31n - 1n)),
  place(
    TWO_TO_THE_53,
    "2⁵³",
    "2⁵³, where JavaScript’s numbers stop counting exactly",
    "Past 2⁵³, JavaScript’s ordinary numbers skip some whole numbers (2⁵³ + 1 comes out as 2⁵³), so the list counts in BigInt.",
  ),
  place(2n ** 61n - 1n, "2⁶¹ − 1", "2⁶¹ − 1, a Mersenne prime from 1883", noteOf(2n ** 61n - 1n)),
  place(
    RECORD_GAP_START,
    "18,361,375,334,787,046,697",
    "the start of a gap of 1,550",
    "The longest gap anyone has found below 2⁶⁴ is 1,550 numbers wide, straight after this prime.",
  ),
  place(2n ** 64n - 59n, "2⁶⁴ − 59", "2⁶⁴ − 59, the largest prime in 64 bits", noteOf(2n ** 64n - 59n)),
  place(PROOFS_BEGIN, "3,317,044,064,679,887,385,961,981", "where every prime starts needing a certificate", noteOf(PROOFS_BEGIN)),
  place(2n ** 89n - 1n, "2⁸⁹ − 1", "2⁸⁹ − 1, a Mersenne prime from 1911", noteOf(2n ** 89n - 1n)),
  place(PI_38_DIGITS, "31,415,926,535,897,932,384,626,433,832,795,028,841", "the first 38 digits of π, and prime", noteOf(PI_38_DIGITS)),
  place(2n ** 127n - 1n, "2¹²⁷ − 1", "2¹²⁷ − 1, proved prime by hand in 1876", noteOf(2n ** 127n - 1n)),
  place(10n ** 100n + 267n, "10¹⁰⁰ + 267", "the first prime after a googol", noteOf(10n ** 100n + 267n), true),
  place(2n ** 521n - 1n, "2⁵²¹ − 1", "the first prime found by a computer", noteOf(2n ** 521n - 1n), true),
];

/** The places listed on /fun-facts: all but the hidden ones. */
export const LISTED_DESTINATIONS = DESTINATIONS.filter((destination) => !destination.hidden);

/** The places a random pick chooses from: none of the slow ones, so it never means a minute's wait. */
export const RANDOM_DESTINATIONS = DESTINATIONS.filter((destination) => !destination.slow);

/** The destination at exactly `value`, if there is one. */
export function destinationAt(value: bigint): Destination | undefined {
  return DESTINATIONS.find((destination) => destination.value === value);
}

/** A random number in [0, 1), like Math.random. */
export type RandomSource = () => number;

/**
 * Where the randomness comes from: Math.random, unless an end-to-end test has set
 * `window.everyPrimeNumberDestinationRandom` before the page loaded.
 */
export function destinationRandom(): number {
  const override = (globalThis as { everyPrimeNumberDestinationRandom?: RandomSource }).everyPrimeNumberDestinationRandom;
  return (override ?? Math.random)();
}

/** A random place from the pool, never the one the list was just sent to (`current`), so a click always moves. */
export function pickDestination(current: bigint | null, random: RandomSource = destinationRandom): Destination {
  const choices = RANDOM_DESTINATIONS.filter((destination) => destination.value !== current);
  return choices[Math.min(Math.floor(random() * choices.length), choices.length - 1)];
}
