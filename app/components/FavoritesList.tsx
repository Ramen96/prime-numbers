"use client";

import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import scrollbar from "./ThemedScrollbar.module.scss";
import { WrappableNumber } from "./WrappableNumber";

/**
 * A guess for rows that haven't been on screen yet: one line of digits.
 * Primes can have any number of digits and wrap, so real heights vary; each
 * row's measured height replaces the guess once it has been rendered.
 */
const ESTIMATED_ROW_HEIGHT_PX = 53;
/** Rows are rendered this far above and below the visible area, so fast scrolling doesn't show gaps. */
const RENDER_MARGIN_PX = 600;
/** Until the browser can measure, assume a typical screen. */
const INITIAL_VIEWPORT_HEIGHT_GUESS_PX = 800;

const numberFormatter = new Intl.NumberFormat("en-US");

interface Props {
  /** Decimal strings, ascending. */
  favorites: readonly string[];
  onRemoveFavorite: (prime: bigint) => void;
}

/** The first index whose value is greater than `target`, in an ascending array. */
function firstIndexAbove(ascending: readonly number[], target: number): number {
  let low = 0;
  let high = ascending.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ascending[middle] > target) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * The favorites, virtualized: there's no cap on how many someone can have, so
 * only the rows near the visible area are in the DOM, however long the list.
 */
export function FavoritesList({ favorites, onRemoveFavorite }: Props) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTopPx, setScrollTopPx] = useState(0);
  const [viewportHeightPx, setViewportHeightPx] = useState(INITIAL_VIEWPORT_HEIGHT_GUESS_PX);
  /** Measured row heights, by prime. Cleared when the width changes, since wrapping depends on it. */
  const [measuredHeights, setMeasuredHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  /** After a removal, which row's remove button should get keyboard focus. */
  const focusRemoveButtonAtIndexRef = useRef<number | null>(null);

  // Where each row starts (rowTops[i]), and the total height (rowTops[length]).
  const rowTops = useMemo(() => {
    const tops = [0];
    for (const favorite of favorites) {
      tops.push(tops[tops.length - 1] + (measuredHeights.get(favorite) ?? ESTIMATED_ROW_HEIGHT_PX));
    }
    return tops;
  }, [favorites, measuredHeights]);

  const firstRenderedIndex = Math.max(0, firstIndexAbove(rowTops, scrollTopPx - RENDER_MARGIN_PX) - 1);
  const lastRenderedIndexExclusive = Math.min(
    favorites.length,
    firstIndexAbove(rowTops, scrollTopPx + viewportHeightPx + RENDER_MARGIN_PX),
  );

  // Whenever the rendered rows change: measure them. If a row above the visible
  // area turned out taller or shorter than assumed, everything below it moved,
  // so scroll by the same amount to keep the visible rows in place.
  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    let updatedHeights: Map<string, number> | null = null;
    let heightChangeAboveView = 0;
    for (const row of scrollContainer.querySelectorAll<HTMLElement>("[data-favorite]")) {
      const favorite = row.dataset.favorite!;
      const height = row.offsetHeight;
      if (measuredHeights.get(favorite) === height) continue;
      const assumedHeight = measuredHeights.get(favorite) ?? ESTIMATED_ROW_HEIGHT_PX;
      if (Number(row.dataset.top) + assumedHeight <= scrollContainer.scrollTop) {
        heightChangeAboveView += height - assumedHeight;
      }
      updatedHeights ??= new Map(measuredHeights);
      updatedHeights.set(favorite, height);
    }
    if (heightChangeAboveView !== 0) scrollContainer.scrollTop += heightChangeAboveView;
    if (updatedHeights) setMeasuredHeights(updatedHeights);

    const focusIndex = focusRemoveButtonAtIndexRef.current;
    if (focusIndex !== null) {
      focusRemoveButtonAtIndexRef.current = null;
      const rowToFocus = Math.min(focusIndex, favorites.length - 1);
      scrollContainer
        .querySelector<HTMLButtonElement>(`[data-index="${rowToFocus}"] button`)
        ?.focus();
    }
    // It only sets state when a height actually changed, so this settles after one pass.
  }, [favorites, measuredHeights, firstRenderedIndex, lastRenderedIndexExclusive]);

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    let lastWidthPx = scrollContainer.clientWidth;
    setViewportHeightPx(scrollContainer.clientHeight);
    const resizeObserver = new ResizeObserver(() => {
      setViewportHeightPx(scrollContainer.clientHeight);
      if (scrollContainer.clientWidth !== lastWidthPx) {
        lastWidthPx = scrollContainer.clientWidth;
        setMeasuredHeights(new Map()); // rows wrap differently at a new width
      }
    });
    resizeObserver.observe(scrollContainer);
    return () => resizeObserver.disconnect();
  }, []);

  const renderedRows = [];
  for (let index = firstRenderedIndex; index < lastRenderedIndexExclusive; index++) {
    const favorite = favorites[index];
    const formattedPrime = numberFormatter.format(BigInt(favorite));
    renderedRows.push(
      <li
        key={favorite}
        data-favorite={favorite}
        data-index={index}
        data-top={rowTops[index]}
        aria-setsize={favorites.length}
        aria-posinset={index + 1}
        style={{ top: rowTops[index] }}
        className="absolute inset-x-0 flex items-center gap-1 border-b border-rule py-1 pr-1 pl-4 sm:pl-5"
      >
        <span className="min-w-0 flex-1 py-2 font-mono text-[clamp(1rem,4.6vw,1.25rem)] tabular-nums">
          <WrappableNumber value={BigInt(favorite)} />
        </span>
        <Link
          href={`/?jump=${favorite}`}
          className="inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm text-(--heat-text) underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-(--heat-text)"
        >
          View in list<span className="sr-only"> ({formattedPrime})</span>
        </Link>
        <button
          type="button"
          aria-label={`Remove ${formattedPrime} from favorites`}
          onClick={() => {
            focusRemoveButtonAtIndexRef.current = index;
            onRemoveFavorite(BigInt(favorite));
          }}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-lg text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text)"
        >
          ×
        </button>
      </li>,
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      data-testid="favorites-scroll-container"
      onScroll={(event) => setScrollTopPx(event.currentTarget.scrollTop)}
      className={`${scrollbar.themedScrollbar} min-h-0 flex-1 overflow-y-auto border-t border-rule [overflow-anchor:none] desktop:border-x`}
    >
      <ul aria-label="Favorite primes" className="relative w-full" style={{ height: rowTops[favorites.length] }}>
        {renderedRows}
      </ul>
    </div>
  );
}
