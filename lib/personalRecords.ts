// The rules for personal records, separate from storage and React.

import { largerDecimal, type PersonalRecords } from "./personalData.ts";

/**
 * Whether scrolling currently counts toward "furthest scroll": only while the
 * list has been scrolled continuously from 2. A jump anywhere else stops it
 * counting, until the user jumps back to 2 or reloads.
 */
export interface RecordSession {
  countsTowardFurthestScroll: boolean;
}

/** A fresh page load starts at 2, so scrolling counts. */
export const NEW_RECORD_SESSION: RecordSession = { countsTowardFurthestScroll: true };

/** A jump to anything up to 2 lands on 2, the start of the list. */
export function sessionAfterJump(target: bigint): RecordSession {
  return { countsTowardFurthestScroll: target <= 2n };
}

/** Updates the records with the largest prime that's now on screen. */
export function recordVisiblePrime(
  records: PersonalRecords,
  session: RecordSession,
  largestVisiblePrime: bigint,
): PersonalRecords {
  const visible = largestVisiblePrime.toString();
  return {
    furthestScroll: session.countsTowardFurthestScroll
      ? largerDecimal(records.furthestScroll, visible)
      : records.furthestScroll,
    biggestPrimeVisited: largerDecimal(records.biggestPrimeVisited, visible),
  };
}

/**
 * True when an existing furthest-scroll record was beaten. Setting a first
 * record isn't "beating" one, so a first visit doesn't celebrate straight away.
 */
export function furthestScrollWasBeaten(before: PersonalRecords, after: PersonalRecords): boolean {
  if (before.furthestScroll === null || after.furthestScroll === null) return false;
  return BigInt(after.furthestScroll) > BigInt(before.furthestScroll);
}

export function recordsAreEqual(first: PersonalRecords, second: PersonalRecords): boolean {
  return (
    first.furthestScroll === second.furthestScroll &&
    first.biggestPrimeVisited === second.biggestPrimeVisited
  );
}
