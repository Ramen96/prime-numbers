"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { bufferLabelsAreEstimated } from "@/lib/primes/rollingBuffer";
import type { Batch, BufferStatus, ScrollInstruction } from "@/lib/primes/usePrimeBuffer";
import { StarIcon } from "./StarIcon";
import scrollbar from "./ThemedScrollbar.module.scss";

const ROW_HEIGHT_PX = 44;
/** Extra rows rendered above and below the viewport so fast scrolling doesn't flash blank space. */
const EXTRA_ROWS_RENDERED = 10;
const INITIAL_VIEWPORT_HEIGHT_GUESS_PX = 900;

/**
 * The list has one status row above the primes ("it all begins here") and one
 * below ("computing…"). So on screen, row 0 is the header and prime #0 in the
 * buffer sits in row 1. These rows never change height, so adding or removing
 * them never makes the content jump.
 */
const HEADER_ROWS = 1;
const FOOTER_ROWS = 1;

interface Props {
  batches: Batch[];
  status: BufferStatus;
  /** The sieve can't go further up: the base primes it needs don't fit in memory. */
  reachedMemoryLimit: boolean;
  /** Why calculation stopped with an error, shown above the list. */
  errorMessage: string | null;
  reportView: (firstVisiblePrime: number, lastVisiblePrime: number) => void;
  takeScrollInstruction: () => ScrollInstruction | null;
  /** Decimal strings of the visitor's favorite primes. */
  favoritePrimes: ReadonlySet<string>;
  onToggleFavorite: (prime: bigint) => void;
  /** The largest prime actually on screen (for personal records). */
  onLargestVisiblePrime: (prime: bigint) => void;
}

const numberFormatter = new Intl.NumberFormat("en-US");

// Below 640px a row stacks the prime above its position label, so a 16-digit
// prime, its label and the star all fit; from 640px up they share one line.
const PRIME_ROW_CLASSES =
  "absolute inset-x-0 top-0 flex items-center gap-1 border-b border-rule pr-4 pl-1 whitespace-nowrap tabular-nums sm:gap-3 sm:pr-5 sm:pl-2";
const PRIME_AND_LABEL_CLASSES =
  "flex min-w-0 flex-1 flex-col items-end leading-tight sm:flex-row sm:items-baseline sm:justify-between";
const STATUS_ROW_CLASSES =
  "absolute inset-x-0 top-0 flex items-center justify-center border-b border-rule px-4 text-muted italic";

/** Converts a row position on screen to a position in the prime buffer. */
function screenRowToPrimeIndex(screenRow: number): number {
  return screenRow - HEADER_ROWS;
}

export function PrimeList({
  batches,
  status,
  reachedMemoryLimit,
  errorMessage,
  reportView,
  takeScrollInstruction,
  favoritePrimes,
  onToggleFavorite,
  onLargestVisiblePrime,
}: Props) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  /** Holds the notices above the list (the memory limit, the estimate banner). */
  const noticeAreaRef = useRef<HTMLDivElement>(null);
  const previousNoticeAreaHeightRef = useRef(0);
  const [scrollTopPx, setScrollTopPx] = useState(0);
  // Until the browser can measure, assume a typical screen so the server
  // renders a full first screen of primes into the HTML.
  const [viewportHeightPx, setViewportHeightPx] = useState(INITIAL_VIEWPORT_HEIGHT_GUESS_PX);

  // Join the batches into one array so each screen row maps to one prime.
  const { allPrimes, ordinalOfFirstPrime, labelsAreEstimated } = useMemo(() => {
    const joined: bigint[] = [];
    for (const batch of batches) joined.push(...batch.primes);
    return {
      allPrimes: joined,
      ordinalOfFirstPrime: batches[0]?.ordinalOfFirstPrime ?? 1n,
      // Drives both the "≈" on each label and the estimate banner.
      labelsAreEstimated: bufferLabelsAreEstimated(batches),
    };
  }, [batches]);

  const bufferStartsAtTwo = allPrimes[0] === 2n;


  /** Tells the buffer which primes are on screen so it can decide whether to fetch more. */
  const reportVisiblePrimes = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const scrollBottomPx = scrollContainer.scrollTop + scrollContainer.clientHeight;
    const firstVisibleScreenRow = Math.floor(scrollContainer.scrollTop / ROW_HEIGHT_PX);
    const lastVisibleScreenRow = Math.ceil(scrollBottomPx / ROW_HEIGHT_PX) - 1;

    const firstVisiblePrime = Math.max(0, screenRowToPrimeIndex(firstVisibleScreenRow));
    const lastVisiblePrime = screenRowToPrimeIndex(lastVisibleScreenRow);
    reportView(firstVisiblePrime, lastVisiblePrime);
  }, [reportView]);

  /**
   * Reports the largest prime actually on screen: the list's visible area,
   * cut off at the window's bottom edge (on phones the list can extend below it).
   */
  const reportLargestPrimeOnScreen = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || allPrimes.length === 0) return;
    const containerBox = scrollContainer.getBoundingClientRect();
    const onScreenTopPx = Math.max(containerBox.top, 0);
    const onScreenBottomPx = Math.min(containerBox.bottom, window.innerHeight);
    if (onScreenBottomPx <= onScreenTopPx) return;

    const lastPixelOnScreen = scrollContainer.scrollTop + (onScreenBottomPx - containerBox.top) - 1;
    const lastPrimeOnScreen = Math.min(
      allPrimes.length - 1,
      screenRowToPrimeIndex(Math.floor(lastPixelOnScreen / ROW_HEIGHT_PX)),
    );
    if (lastPrimeOnScreen >= 0) onLargestVisiblePrime(allPrimes[lastPrimeOnScreen]);
  }, [allPrimes, onLargestVisiblePrime]);

  // The page itself scrolls on phones, which can bring more of the list on screen.
  useEffect(() => {
    window.addEventListener("scroll", reportLargestPrimeOnScreen, { passive: true });
    window.addEventListener("resize", reportLargestPrimeOnScreen);
    return () => {
      window.removeEventListener("scroll", reportLargestPrimeOnScreen);
      window.removeEventListener("resize", reportLargestPrimeOnScreen);
    };
  }, [reportLargestPrimeOnScreen]);

  // After the buffer changes, adjust the scroll position:
  // - A batch dropped from the top (scrolling down) or added at the top
  //   (scrolling up) moves every row below it. Scroll by the same amount so
  //   the user keeps seeing the same primes.
  // - After a jump, put the first prime found at the top of the viewport.
  // - The notices sit above the scroll container, so when one appears it
  //   pushes the container's top edge down by its height (and when one goes,
  //   pulls it back up). Scroll by the same amount so the visible primes stay
  //   put on screen.
  // Then check the thresholds again, because a new batch may already have
  // crossed one.
  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const noticeAreaHeight = noticeAreaRef.current?.offsetHeight ?? 0;
    const noticeAreaGrewBy = noticeAreaHeight - previousNoticeAreaHeightRef.current;
    previousNoticeAreaHeightRef.current = noticeAreaHeight;

    const instruction = takeScrollInstruction();
    if (instruction?.type === "showPrimeAtTop") {
      // Absolute position inside the container, so it already lands below the notices.
      scrollContainer.scrollTop = (HEADER_ROWS + instruction.primeIndex) * ROW_HEIGHT_PX;
    } else {
      if (instruction?.type === "keepPosition") {
        scrollContainer.scrollTop += instruction.rowsAddedAbove * ROW_HEIGHT_PX;
      }
      scrollContainer.scrollTop += noticeAreaGrewBy;
    }

    setScrollTopPx(scrollContainer.scrollTop);
    setViewportHeightPx(scrollContainer.clientHeight);
    reportVisiblePrimes();
    reportLargestPrimeOnScreen();
  }, [
    batches,
    labelsAreEstimated,
    reachedMemoryLimit,
    errorMessage,
    takeScrollInstruction,
    reportVisiblePrimes,
    reportLargestPrimeOnScreen,
  ]);

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    const resizeObserver = new ResizeObserver(() =>
      setViewportHeightPx(scrollContainer.clientHeight),
    );
    resizeObserver.observe(scrollContainer);
    return () => resizeObserver.disconnect();
  }, []);

  const handleScroll = () => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    setScrollTopPx(scrollContainer.scrollTop);
    reportVisiblePrimes();
    reportLargestPrimeOnScreen();
  };

  // Only rows near the viewport go into the DOM; the spacer div's height makes
  // the scrollbar behave as if they were all there.
  const totalScreenRows = HEADER_ROWS + allPrimes.length + FOOTER_ROWS;
  const footerScreenRow = totalScreenRows - 1;
  const firstRenderedRow = Math.max(
    0,
    Math.floor(scrollTopPx / ROW_HEIGHT_PX) - EXTRA_ROWS_RENDERED,
  );
  const lastRenderedRowExclusive = Math.min(
    totalScreenRows,
    Math.ceil((scrollTopPx + viewportHeightPx) / ROW_HEIGHT_PX) + EXTRA_ROWS_RENDERED,
  );

  const renderedRows = [];
  for (let screenRow = firstRenderedRow; screenRow < lastRenderedRowExclusive; screenRow++) {
    const positionStyle = {
      transform: `translateY(${screenRow * ROW_HEIGHT_PX}px)`,
      height: ROW_HEIGHT_PX,
    };

    if (screenRow === 0) {
      const headerText =
        allPrimes.length === 0 ? "" : bufferStartsAtTwo ? "it all begins here" : "recomputing the past…";
      renderedRows.push(
        <div key="header" className={STATUS_ROW_CLASSES} style={positionStyle}>
          {headerText}
        </div>,
      );
    } else if (screenRow === footerScreenRow) {
      const footerText =
        reachedMemoryLimit
          ? "memory limit: not checked yet"
          : status === "error"
            ? "the worker gave up"
            : "computing…";
      renderedRows.push(
        <div key="footer" className={STATUS_ROW_CLASSES} style={positionStyle}>
          {footerText}
        </div>,
      );
    } else {
      const primeIndex = screenRowToPrimeIndex(screenRow);
      const prime = allPrimes[primeIndex];
      // 2 is #1, 3 is #2, … After a jump this is estimated (see rollingBuffer.ts).
      const ordinal = numberFormatter.format(ordinalOfFirstPrime + BigInt(primeIndex));
      const formattedPrime = numberFormatter.format(prime);
      const isFavorite = favoritePrimes.has(String(prime));
      renderedRows.push(
        <div
          key={String(prime)}
          data-testid="prime-row"
          data-prime={String(prime)}
          className={PRIME_ROW_CLASSES}
          style={positionStyle}
        >
          <button
            type="button"
            aria-pressed={isFavorite}
            aria-label={`Favorite ${formattedPrime}`}
            onClick={() => onToggleFavorite(prime)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text) aria-pressed:text-(--heat-text)"
          >
            <StarIcon filled={isFavorite} />
          </button>
          <div className={PRIME_AND_LABEL_CLASSES}>
            <span
              data-testid="prime-label"
              className={`order-2 text-[0.7rem] text-muted sm:order-1 sm:text-[0.8rem] ${labelsAreEstimated ? "opacity-70" : ""}`}
            >
              {labelsAreEstimated ? `≈ #${ordinal}` : `#${ordinal}`}
            </span>
            <span className="order-1 font-mono text-[clamp(1rem,4.6vw,1.25rem)] sm:order-2">
              {formattedPrime}
            </span>
          </div>
        </div>,
      );
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Outside the scroll container, so notices stay put and never cover a row. */}
      <div ref={noticeAreaRef}>
        {errorMessage && (
          <p role="alert" className="bg-(--hot-surface) px-5 py-3 text-white">
            <strong>Stopped.</strong> {errorMessage}
          </p>
        )}
        {reachedMemoryLimit && (
          <p role="status" className="bg-(--hot-surface) px-5 py-3 text-white">
            <strong>This device’s memory limit.</strong> Going further needs more base primes than
            fit in its memory, so the list stops at the last prime it could prove. Nothing after
            it has been skipped or guessed; it just hasn’t been checked.
          </p>
        )}
        {labelsAreEstimated && (
          <p role="status" className="border-b border-rule px-5 py-1.5 text-xs text-muted">
            Positions after a jump are estimated. Scroll back to 2 for exact counts.
          </p>
        )}
      </div>
      <div
        ref={scrollContainerRef}
        data-testid="prime-list"
        data-status={status}
        className={`${scrollbar.themedScrollbar} min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]`}
        onScroll={handleScroll}
      >
        <div className="relative w-full" style={{ height: totalScreenRows * ROW_HEIGHT_PX }}>
          {renderedRows}
        </div>
      </div>
    </div>
  );
}
