"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { WrappableNumber } from "./WrappableNumber";

const numberFormatter = new Intl.NumberFormat("en-US");
const COPIED_MESSAGE_MS = 2000;

/**
 * The popup that shows a shortened number in full (see FittedNumber.tsx and
 * PrimeList.tsx): every digit, wrapped at commas, how many digits there are,
 * and a Copy button. A native popover, so Escape and clicking outside close
 * it, and the browser keeps it above everything. When it closes, focus goes
 * back to the number that opened it.
 *
 * Returns `show(value, opener)` and the popover element to render once.
 */
export function useNumberPopover(): {
  show: (value: bigint, opener: HTMLElement) => void;
  popover: ReactNode;
} {
  const popoverRef = useRef<HTMLDivElement>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  // Bumped on every show, so showing the same number twice still opens it.
  const [request, setRequest] = useState<{ value: bigint; count: number } | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const copyMessageTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const titleId = useId();

  const show = useCallback((value: bigint, opener: HTMLElement) => {
    openerRef.current = opener;
    setCopyMessage("");
    setRequest((previous) => ({ value, count: (previous?.count ?? 0) + 1 }));
  }, []);

  // Open once the number is rendered inside, then move focus into it.
  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!request || !popover) return;
    if (!popover.matches(":popover-open")) popover.showPopover();
    copyButtonRef.current?.focus();
  }, [request]);

  // Back to the opener on close, unless the user clicked something else that
  // took focus (clicking outside closes it too).
  useEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState !== "closed") return;
      const focusWasLeftBehind =
        document.activeElement === document.body || popover.contains(document.activeElement);
      const opener = openerRef.current;
      if (focusWasLeftBehind && opener?.isConnected) opener.focus();
    };
    popover.addEventListener("toggle", onToggle);
    return () => popover.removeEventListener("toggle", onToggle);
  }, []);

  useEffect(() => () => clearTimeout(copyMessageTimerRef.current), []);

  const copy = async () => {
    if (!request) return;
    clearTimeout(copyMessageTimerRef.current);
    try {
      // the digits alone, the way the number would be typed or pasted elsewhere
      await navigator.clipboard.writeText(String(request.value));
      setCopyMessage("Copied");
    } catch {
      setCopyMessage("Couldn’t copy");
    }
    copyMessageTimerRef.current = setTimeout(() => setCopyMessage(""), COPIED_MESSAGE_MS);
  };

  const digitCount = request ? String(request.value).length : 0;
  const popover = (
    <div
      ref={popoverRef}
      popover="auto"
      role="dialog"
      aria-labelledby={titleId}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-rule bg-background p-5 text-foreground shadow-xl backdrop:bg-black/30"
    >
      <h2 id={titleId} className="text-xs tracking-widest text-muted uppercase">
        {numberFormatter.format(digitCount)} digits
      </h2>
      <p className="mt-2 font-mono text-lg leading-snug tabular-nums">
        <WrappableNumber value={request?.value ?? null} />
      </p>
      <div className="mt-4 flex items-center gap-2">
        <button
          ref={copyButtonRef}
          type="button"
          onClick={copy}
          className="h-11 rounded-md border border-rule px-4 text-sm font-medium hover:border-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text)"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={() => popoverRef.current?.hidePopover()}
          className="h-11 rounded-md border border-rule px-4 text-sm font-medium hover:border-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text)"
        >
          Close
        </button>
        <p role="status" className="ml-1 text-sm text-muted">
          {copyMessage}
        </p>
      </div>
    </div>
  );
  return { show, popover };
}
