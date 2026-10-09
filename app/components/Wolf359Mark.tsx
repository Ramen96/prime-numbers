"use client";

import { useEffect, useState } from "react";

/** A Star Trek easter egg: the prime 359, as in Wolf 359, gets a small cube (in the prime list and favorites). */
export const WOLF_359_PRIME = 359n;

/** How long the tapped tooltip stays up. */
const TOOLTIP_MS = 2500;

/**
 * A small dark-green wireframe cube shown after 359 in the prime list and favorites.
 * Decorative: hidden from screen readers (the number is announced as usual),
 * not focusable, not selectable, so it changes nothing that's copied. Hover
 * shows the native "Wolf 359" tooltip; a tap shows the same words in a small
 * bubble, since touch screens have no hover. It's inline and about as tall
 * as the text, and the bubble is positioned absolutely, so the row's height
 * never changes.
 */
export function Wolf359Mark() {
  const [tooltipShown, setTooltipShown] = useState(false);

  useEffect(() => {
    if (!tooltipShown) return;
    const timer = setTimeout(() => setTooltipShown(false), TOOLTIP_MS);
    return () => clearTimeout(timer);
  }, [tooltipShown]);

  return (
    <span
      aria-hidden
      data-testid="wolf-359-cube"
      title="Wolf 359"
      onClick={() => setTooltipShown((shown) => !shown)}
      className="relative ml-2 inline-block cursor-default align-[-0.1em] text-green-800 select-none dark:text-green-500"
    >
      {/* An isometric wireframe cube: the outline, plus the three edges that meet at the front corner. */}
      <svg viewBox="0 0 24 24" className="block h-[0.95em] w-[0.95em]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round">
        <path d="M12 2.5 20.5 7.25v9.5L12 21.5l-8.5-4.75v-9.5Z" />
        <path d="M3.5 7.25 12 12l8.5-4.75M12 12v9.5" />
      </svg>
      {tooltipShown && (
        <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 rounded bg-foreground px-1.5 py-0.5 font-sans text-xs whitespace-nowrap text-background not-italic">
          Wolf 359
        </span>
      )}
    </span>
  );
}
