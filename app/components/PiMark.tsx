/**
 * An easter egg: 314,159 is prime, and its digits are the first six of π,
 * so wherever it's listed (the prime list, favorites) it gets a π beside it.
 */
export const PI_PRIME = 314_159n;

/** The π shown after 314,159. */
export function PiMark() {
  return (
    <span title="Its digits are the first six of π" className="ml-2 font-serif text-(--heat-text) italic">
      π<span className="sr-only">: its digits are the first six of pi</span>
    </span>
  );
}
