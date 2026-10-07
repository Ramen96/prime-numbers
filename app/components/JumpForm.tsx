"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type SubmitEvent } from "react";
import { jumpParameterFrom, urlForJump } from "@/lib/jumpUrl";
import { parseJumpTarget } from "@/lib/primes/parseJumpTarget";
import type { JumpResult } from "@/lib/primes/usePrimeBuffer";
import styles from "./JumpForm.module.scss";

interface Props {
  onJump: (target: bigint) => void;
  lastJump: JumpResult | null;
}

const numberFormatter = new Intl.NumberFormat("en-US");

// The page is statically rendered, so ?jump= can only be read in the browser:
// the server snapshot is always an empty query string.
const subscribeToNothing = () => () => {};
const readQueryString = () => window.location.search;
const readServerQueryString = () => "";

export function JumpForm({ onJump, lastJump }: Props) {
  // null until the user types or submits; until then the box shows ?jump=.
  const [userInput, setUserInput] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
    // Make the URL shareable without reloading or adding a history entry per jump.
    window.history.replaceState(null, "", urlForJump(window.location.href, result.target));
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
          placeholder="Jump to… e.g. 15,000,000"
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
      </div>

      <p id="jump-feedback" aria-live="polite" className="mt-1.5 min-h-5 text-sm">
        {shownError ? (
          <span className="text-(--hot-text)">{shownError}</span>
        ) : lastJump ? (
          // Keyed by generation so the fade-out restarts on every jump.
          <span key={lastJump.generation} className={`${styles.fadingNotice} text-muted`}>
            Jumped to{" "}
            <span className="font-mono text-foreground">
              {numberFormatter.format(lastJump.firstPrimeFound)}
            </span>
            {lastJump.firstPrimeFound !== lastJump.requestedNumber &&
              ` (first prime ≥ ${numberFormatter.format(lastJump.requestedNumber)})`}
          </span>
        ) : null}
      </p>
    </form>
  );
}
