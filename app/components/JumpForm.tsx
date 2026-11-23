"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type SubmitEvent,
} from "react";
import Link from "next/link";
import { destinationAt, pickDestination } from "@/lib/destinations";
import { formatWholeNumber } from "@/lib/formatNumber";
import { fitNumber, type GlyphWidths } from "@/lib/shortenNumber";
import { jumpParameterFrom } from "@/lib/jumpUrl";
import { parseJumpTarget } from "@/lib/primes/parseJumpTarget";
import type { JumpResult } from "@/lib/primes/usePrimeBuffer";
import { CompassIcon } from "./CompassIcon";
import fadingNotice from "./FadingNotice.module.scss";
import { GlyphRuler, readGlyphWidths } from "./GlyphRuler";

const SURPRISE_LABEL = "Take me somewhere interesting";

// The example only fits the desktop's wider box: on phones the box shares its row with the compass button.
const DESKTOP_MEDIA_QUERY = "(min-width: 64rem) and (min-height: 37.5rem)"; // the `desktop` variant in globals.css
const subscribeToDesktopMedia = (onChange: () => void) => {
  const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
const readIsDesktop = () => window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
const readServerIsDesktop = () => false;

/**
 * What the jump line has room for, measured from invisible copies of its parts
 * (and again when its width changes): far out, the numbers in “Jumped to …
 * (first prime ≥ …)” are too long for any line, so each is shortened in the
 * middle to fit one (lib/shortenNumber.ts), like the list's primes. Plain text,
 * not buttons: the line fades, the prime found is the list's first row (which
 * opens in full), and the number asked for is in the box.
 */
interface JumpLineSpace {
  lineWidthPx: number;
  primeGlyphs: GlyphWidths;
  requestedGlyphs: GlyphWidths;
  /** “Jumped to ”, before the prime. */
  jumpedToPx: number;
  /** “(first prime ≥ ” and “)”, around the number asked for. */
  firstPrimeAtLeastPx: number;
}

function useJumpLineSpace() {
  const lineRef = useRef<HTMLParagraphElement>(null);
  const primeRulerRef = useRef<HTMLSpanElement>(null);
  const requestedRulerRef = useRef<HTMLSpanElement>(null);
  const jumpedToRef = useRef<HTMLSpanElement>(null);
  const firstPrimeAtLeastRef = useRef<HTMLSpanElement>(null);
  const [space, setSpace] = useState<JumpLineSpace | null>(null);

  useLayoutEffect(() => {
    const line = lineRef.current;
    if (!line) return;
    const measure = () => {
      const primeGlyphs = readGlyphWidths(primeRulerRef.current);
      const requestedGlyphs = readGlyphWidths(requestedRulerRef.current);
      if (!primeGlyphs || !requestedGlyphs) return;
      const next = {
        lineWidthPx: line.clientWidth,
        primeGlyphs,
        requestedGlyphs,
        jumpedToPx: jumpedToRef.current?.getBoundingClientRect().width ?? 0,
        firstPrimeAtLeastPx: firstPrimeAtLeastRef.current?.getBoundingClientRect().width ?? 0,
      };
      setSpace((previous) =>
        previous && previous.lineWidthPx === next.lineWidthPx && previous.primeGlyphs.digit === next.primeGlyphs.digit
          ? previous
          : next,
      );
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(line);
    document.fonts?.ready.then(measure);
    return () => resizeObserver.disconnect();
  }, []);

  const rulers = (
    <span aria-hidden className="pointer-events-none invisible absolute top-0 left-0 w-0 overflow-hidden whitespace-pre">
      <span ref={primeRulerRef} className="font-mono">
        <GlyphRuler />
      </span>
      <span ref={requestedRulerRef}>
        <GlyphRuler />
      </span>
      {/* generated content, not text, so nothing on the page reads or finds them */}
      <span ref={jumpedToRef} data-text="Jumped to " className="absolute before:content-[attr(data-text)]" />
      <span ref={firstPrimeAtLeastRef} data-text=" (first prime ≥ )" className="absolute before:content-[attr(data-text)]" />
    </span>
  );
  return { lineRef, rulers, space };
}

interface Props {
  /** Jumps, and updates the URL so it can be shared. */
  onJump: (target: bigint) => void;
  lastJump: JumpResult | null;
}


// The page is statically rendered, so ?jump= can only be read in the browser:
// the server snapshot is always an empty query string.
const subscribeToNothing = () => () => {};
const readQueryString = () => window.location.search;
const readServerQueryString = () => "";

export function JumpForm({ onJump, lastJump }: Props) {
  // null until the user types or submits; until then the box shows ?jump=.
  const [userInput, setUserInput] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isDesktop = useSyncExternalStore(subscribeToDesktopMedia, readIsDesktop, readServerIsDesktop);
  const queryString = useSyncExternalStore(subscribeToNothing, readQueryString, readServerQueryString);
  const jumpFromUrl = jumpParameterFrom(queryString);
  const shownInput = userInput ?? jumpFromUrl ?? "";
  const invalidUrlJumpMessage = (() => {
    if (userInput !== null || jumpFromUrl === null) return null;
    const result = parseJumpTarget(jumpFromUrl);
    return result.valid ? null : result.message;
  })();
  const shownError = errorMessage ?? invalidUrlJumpMessage;

  // Follow a shared link: jump once on load if ?jump= holds a valid number.
  const hasFollowedUrlJumpRef = useRef(false);
  useEffect(() => {
    if (hasFollowedUrlJumpRef.current) return;
    hasFollowedUrlJumpRef.current = true;
    const urlJumpText = jumpParameterFrom(window.location.search);
    if (urlJumpText === null) return;
    const result = parseJumpTarget(urlJumpText);
    if (result.valid) onJump(result.target);
  }, [onJump]);

  // A random place from lib/destinations.ts, through the same jump; the box shows where it went.
  const jumpSomewhereInteresting = () => {
    const destination = pickDestination(lastJump?.requestedNumber ?? null);
    setUserInput(destination.value.toString());
    setErrorMessage(null);
    onJump(destination.value);
  };
  const landedOn = lastJump ? destinationAt(lastJump.requestedNumber) : undefined;

  const { lineRef, rulers, space } = useJumpLineSpace();
  const shownFirstPrime = lastJump ? formatWholeNumber(lastJump.firstPrimeFound) : "";
  const shownRequested = lastJump ? formatWholeNumber(lastJump.requestedNumber) : "";
  // each on a line of its own if it must be: the line wraps between the words around them
  const fittedFirstPrime = space ? fitNumber(shownFirstPrime, space.lineWidthPx - space.jumpedToPx, space.primeGlyphs).text : shownFirstPrime;
  const fittedRequested = space
    ? fitNumber(shownRequested, space.lineWidthPx - space.firstPrimeAtLeastPx, space.requestedGlyphs).text
    : shownRequested;

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    setUserInput(shownInput);
    const result = parseJumpTarget(shownInput);
    if (!result.valid) {
      setErrorMessage(result.message);
      return;
    }
    setErrorMessage(null);
    onJump(result.target);
  };

  return (
    <form onSubmit={handleSubmit} className="border-b border-rule px-5 py-3 desktop:px-0">
      <div className="flex gap-2">
        <label htmlFor="jump-target" className="sr-only">
          Jump to number
        </label>
        <input
          id="jump-target"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={isDesktop ? "Jump to… e.g. 15,000,000" : "Jump to…"}
          value={shownInput}
          onChange={(event) => setUserInput(event.target.value)}
          aria-invalid={shownError !== null}
          aria-describedby="jump-feedback"
          className="min-w-0 flex-1 h-11 rounded-md border bg-transparent px-3 tabular-nums outline-none placeholder:font-sans placeholder:text-muted aria-invalid:border-(--hot)"
        />
        <button
          type="submit"
          className="h-11 rounded-md bg-foreground px-5 font-medium text-background hover:opacity-85 active:opacity-70"
        >
          Jump
        </button>
        {/* phones only: a width's worth, never a line of the list's height; desktop has the text button below */}
        <button
          type="button"
          onClick={jumpSomewhereInteresting}
          aria-label={SURPRISE_LABEL}
          title={SURPRISE_LABEL}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-rule hover:border-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text) desktop:hidden"
          data-testid="surprise-icon-button"
        >
          <CompassIcon />
        </button>
      </div>

      {/* the rulers beside the line, in its font, so their text never joins what the line says */}
      <div className="relative text-sm">
        {rulers}
        <p ref={lineRef} id="jump-feedback" aria-live="polite" className="mt-1.5 min-h-5 text-sm">
          {shownError ? (
            <span className="text-(--hot-text)">{shownError}</span>
          ) : lastJump ? (
            // Keyed by generation so the fade-out restarts on every jump.
            <span key={lastJump.generation} className={`${fadingNotice.fadingNotice} ${landedOn ? fadingNotice.fadingNoticeLonger : ""} text-muted`}>
              Jumped to{" "}
              <span className="font-mono whitespace-nowrap text-foreground">{fittedFirstPrime}</span>
              {lastJump.firstPrimeFound !== lastJump.requestedNumber && (
                <>
                  {" (first prime ≥ "}
                  <span className="whitespace-nowrap">{fittedRequested}</span>)
                </>
              )}
              {landedOn && `: ${landedOn.name}.`}
            </span>
          ) : null}
        </p>
      </div>

      <div className="mt-2 hidden flex-wrap items-center gap-x-4 gap-y-1 desktop:flex">
        <button
          type="button"
          onClick={jumpSomewhereInteresting}
          className="h-11 rounded-md border border-rule px-4 text-sm font-medium hover:border-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text)"
        >
          {SURPRISE_LABEL}
        </button>
        <Link href="/fun-facts#places-to-visit" className="text-sm text-(--heat-text) underline underline-offset-2">
          All the places →
        </Link>
      </div>
    </form>
  );
}
