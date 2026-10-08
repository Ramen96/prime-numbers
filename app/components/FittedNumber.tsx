"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { fitNumber, type GlyphWidths } from "@/lib/shortenNumber";
import { GlyphRuler, readGlyphWidths } from "./GlyphRuler";

const numberFormatter = new Intl.NumberFormat("en-US");

/**
 * Classes for a shortened number, which opens the full one when clicked: a
 * dotted underline as the hint, and a 44px-tall tap target (an invisible
 * ::before) whatever the font size. Clipped sideways only, so nothing can
 * overflow but the tap target isn't cut off above and below.
 */
export const SHORTENED_NUMBER_CLASSES =
  "relative max-w-full cursor-pointer overflow-x-clip rounded-sm text-left whitespace-nowrap underline decoration-dotted decoration-1 underline-offset-4 focus-visible:outline-2 focus-visible:outline-(--heat-text) before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']";

/**
 * A number on one line in whatever width its container gives it, shortened
 * in the middle if it doesn't fit (see lib/shortenNumber.ts). A shortened
 * number is a button that opens the full one (`onShowFull`); one that fits is
 * plain text. Its accessible name is always the whole number. For a handful
 * of numbers, such as the stats under the counter: each measures its own
 * width. (The prime list measures once for all its rows instead.)
 */
export function FittedNumber({
  value,
  onShowFull,
  className = "",
}: {
  value: bigint | null;
  onShowFull: (value: bigint, opener: HTMLElement) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const rulerRef = useRef<HTMLSpanElement>(null);
  const [space, setSpace] = useState<{ widthPx: number; glyphs: GlyphWidths } | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const glyphs = readGlyphWidths(rulerRef.current);
      if (!glyphs) return;
      const widthPx = container.clientWidth;
      setSpace((previous) =>
        previous && previous.widthPx === widthPx && previous.glyphs.digit === glyphs.digit
          ? previous
          : { widthPx, glyphs },
      );
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(container);
    document.fonts?.ready.then(measure);
    return () => resizeObserver.disconnect();
  }, []);

  const formatted = value === null ? "—" : numberFormatter.format(value);
  const fitted =
    value !== null && space ? fitNumber(formatted, space.widthPx, space.glyphs) : { text: formatted, shortened: false };

  return (
    <span ref={containerRef} className={`relative block min-w-0 overflow-x-clip whitespace-nowrap ${className}`}>
      <span ref={rulerRef}>
        <GlyphRuler />
      </span>
      {fitted.shortened && value !== null ? (
        <button
          type="button"
          aria-label={formatted}
          aria-haspopup="dialog"
          onClick={(event) => onShowFull(value, event.currentTarget)}
          className={SHORTENED_NUMBER_CLASSES}
        >
          <span aria-hidden>{fitted.text}</span>
        </button>
      ) : (
        formatted
      )}
    </span>
  );
}
