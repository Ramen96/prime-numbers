"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type SubmitEvent,
} from "react";
import Link from "next/link";
import { destinationAt, pickDestination } from "@/lib/destinations";
import { formatWholeNumber } from "@/lib/formatNumber";
import { jumpParameterFrom } from "@/lib/jumpUrl";
import { parseJumpTarget } from "@/lib/primes/parseJumpTarget";
import type { JumpResult } from "@/lib/primes/usePrimeBuffer";
import { CompassIcon } from "./CompassIcon";
import fadingNotice from "./FadingNotice.module.scss";

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

      <p id="jump-feedback" aria-live="polite" className="mt-1.5 min-h-5 text-sm">
        {shownError ? (
          <span className="text-(--hot-text)">{shownError}</span>
        ) : lastJump ? (
          // Keyed by generation so the fade-out restarts on every jump.
          <span key={lastJump.generation} className={`${fadingNotice.fadingNotice} ${landedOn ? fadingNotice.fadingNoticeLonger : ""} text-muted`}>
            Jumped to{" "}
            <span className="font-mono text-foreground">
              {formatWholeNumber(lastJump.firstPrimeFound)}
            </span>
            {lastJump.firstPrimeFound !== lastJump.requestedNumber &&
              ` (first prime ≥ ${formatWholeNumber(lastJump.requestedNumber)})`}
            {landedOn && `: ${landedOn.name}.`}
          </span>
        ) : null}
      </p>

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
