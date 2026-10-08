"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { bufferLabelsAreEstimated } from "@/lib/primes/rollingBuffer";
import type { Batch, BufferStatus, ScrollInstruction } from "@/lib/primes/usePrimeBuffer";
import { fitNumber, textWidth, type GlyphWidths } from "@/lib/shortenNumber";
import { SHORTENED_NUMBER_CLASSES } from "./FittedNumber";
import { GlyphRuler, readGlyphWidths } from "./GlyphRuler";
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
  /** Opens the popup with a shortened prime in full. */
  onShowFullPrime: (prime: bigint, opener: HTMLElement) => void;
}

const numberFormatter = new Intl.NumberFormat("en-US");

// Below 640px a row stacks the prime above its position label, so a 16-digit
// prime, its label and the star all fit; from 640px up they share one line.
const PRIME_ROW_CLASSES =
  "absolute inset-x-0 top-0 flex items-center gap-1 border-b border-rule pr-4 pl-1 whitespace-nowrap tabular-nums sm:gap-3 sm:pr-5 sm:pl-2";
const PRIME_AND_LABEL_CLASSES =
  "flex min-w-0 flex-1 flex-col items-end leading-tight sm:flex-row sm:items-baseline sm:justify-between";
const LABEL_FONT_CLASSES = "text-[0.7rem] sm:text-[0.8rem]";
const PRIME_FONT_CLASSES = "font-mono text-[clamp(1rem,4.6vw,1.25rem)]";
const STATUS_ROW_CLASSES =
  "absolute inset-x-0 top-0 flex items-center justify-center border-b border-rule px-4 text-muted italic";

/**
 * What a row has room for, measured once from an invisible row laid out like
 * the real ones (and again when the list's width changes), so no row is
 * measured on its own. Every row has the same space; only its position
 * label's length differs, and that's worked out from the label font's widths.
 */
interface RowSpace {
  /** The width the prime and its position label share. */
  columnPx: number;
  /** From 640px up the label sits beside the prime; below, under it. */
  labelBesidePrime: boolean;
  primeGlyphs: GlyphWidths;
  labelGlyphs: GlyphWidths;
  /** The width of the label before its digits: "#", or "≈ #" after a jump. */
  labelPrefixPx: { exact: number; estimated: number };
}

function sameRowSpace(a: RowSpace | null, b: RowSpace): boolean {
  return (
    a !== null &&
    a.columnPx === b.columnPx &&
    a.labelBesidePrime === b.labelBesidePrime &&
    a.primeGlyphs.digit === b.primeGlyphs.digit &&
    a.labelGlyphs.digit === b.labelGlyphs.digit
  );
}

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
  onShowFullPrime,
}: Props) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  /** Holds the notices above the list (the memory limit, the estimate banner). */
  const noticeAreaRef = useRef<HTMLDivElement>(null);
  const previousNoticeAreaHeightRef = useRef(0);
  const [scrollTopPx, setScrollTopPx] = useState(0);
  // Until the browser can measure, assume a typical screen so the server
  // renders a full first screen of primes into the HTML.
  const [viewportHeightPx, setViewportHeightPx] = useState(INITIAL_VIEWPORT_HEIGHT_GUESS_PX);
  // Null until measured (and on the server): primes are shown whole until then.
  const [rowSpace, setRowSpace] = useState<RowSpace | null>(null);
  const measuringColumnRef = useRef<HTMLDivElement>(null);
  const primeRulerRef = useRef<HTMLSpanElement>(null);
  const labelRulerRef = useRef<HTMLSpanElement>(null);
  const exactPrefixRef = useRef<HTMLSpanElement>(null);
  const estimatedPrefixRef = useRef<HTMLSpanElement>(null);

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

  // Measures the invisible row: on mount, whenever the list's size changes
  // (the prime's font size follows the window's width too), and once the
  // web fonts have loaded.
  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    const measure = () => {
      const column = measuringColumnRef.current;
      const primeGlyphs = readGlyphWidths(primeRulerRef.current);
      const labelGlyphs = readGlyphWidths(labelRulerRef.current);
      if (!column || !primeGlyphs || !labelGlyphs) return;
      const measured: RowSpace = {
        columnPx: column.clientWidth,
        labelBesidePrime: getComputedStyle(column).flexDirection === "row",
        primeGlyphs,
        labelGlyphs,
        labelPrefixPx: {
          exact: exactPrefixRef.current?.getBoundingClientRect().width ?? 0,
          estimated: estimatedPrefixRef.current?.getBoundingClientRect().width ?? 0,
        },
      };
      setRowSpace((previous) => (sameRowSpace(previous, measured) ? previous : measured));
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(scrollContainer);
    document.fonts?.ready.then(measure);
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
      // Shortened in the middle if it doesn't fit beside (or above) its label.
      let shownPrime = { text: formattedPrime, shortened: false };
      if (rowSpace) {
        const labelPx =
          (labelsAreEstimated ? rowSpace.labelPrefixPx.estimated : rowSpace.labelPrefixPx.exact) +
          textWidth(ordinal, rowSpace.labelGlyphs);
        // beside the label, keep at least a digit's width between them
        const availablePx = rowSpace.labelBesidePrime
          ? rowSpace.columnPx - labelPx - rowSpace.primeGlyphs.digit
          : rowSpace.columnPx;
        shownPrime = fitNumber(formattedPrime, availablePx, rowSpace.primeGlyphs);
      }
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
              className={`order-2 ${LABEL_FONT_CLASSES} text-muted sm:order-1 ${labelsAreEstimated ? "opacity-70" : ""}`}
            >
              {labelsAreEstimated ? `≈ #${ordinal}` : `#${ordinal}`}
            </span>
            {shownPrime.shortened ? (
              // The whole prime stays the accessible name; a tap shows it all.
              <button
                type="button"
                aria-label={formattedPrime}
                aria-haspopup="dialog"
                onClick={(event) => onShowFullPrime(prime, event.currentTarget)}
                className={`order-1 ${PRIME_FONT_CLASSES} sm:order-2 ${SHORTENED_NUMBER_CLASSES}`}
              >
                <span aria-hidden>{shownPrime.text}</span>
              </button>
            ) : (
              <span className={`order-1 ${PRIME_FONT_CLASSES} sm:order-2`}>{formattedPrime}</span>
            )}
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
          {/* Laid out like a prime row, never seen: measured for RowSpace. */}
          <div aria-hidden className={`${PRIME_ROW_CLASSES} pointer-events-none invisible`} style={{ height: ROW_HEIGHT_PX }}>
            <span className="h-11 w-11 shrink-0" />
            <div ref={measuringColumnRef} className={PRIME_AND_LABEL_CLASSES}>
              <span className={`relative order-2 ${LABEL_FONT_CLASSES} sm:order-1`}>
                <span ref={labelRulerRef}>
                  <GlyphRuler />
                </span>
                <span ref={exactPrefixRef} className="absolute whitespace-pre">
                  #
                </span>
                <span ref={estimatedPrefixRef} className="absolute whitespace-pre">
                  ≈ #
                </span>
              </span>
              <span ref={primeRulerRef} className={`relative order-1 ${PRIME_FONT_CLASSES} sm:order-2`}>
                <GlyphRuler />
              </span>
            </div>
          </div>
          {renderedRows}
        </div>
      </div>
    </div>
  );
}
