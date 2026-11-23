"use client";

import { useEffect, useRef, useState } from "react";

/** How long “Copied” (or “Couldn’t copy”) shows before the button reads its label again. */
const COPY_FEEDBACK_MS = 2_000;

const BUTTON_CLASS =
  "inline-flex h-11 items-center rounded-md border border-rule px-4 text-sm font-medium hover:border-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text)";

type CopyOutcome = "idle" | "copied" | "failed";

interface Props {
  /** The button's label and accessible name: “Copy as text”. */
  label: string;
  /** What to copy, made only when clicked (a certificate can be long). */
  text: () => string;
  /** Announced once copied: “Copied the certificate as text.” */
  copiedAnnouncement: string;
  /** Announced if the browser won't allow it. */
  failedAnnouncement: string;
  /** The status line's test id. */
  statusTestId: string;
}

/**
 * Copies `text()` to the clipboard. Every label is stacked in one grid cell, so
 * the button keeps its width; the outcome is announced in a status line of its
 * own, and the button's name stays `label`.
 */
export function CopyButton({ label, text, copiedAnnouncement, failedAnnouncement, statusTestId }: Props) {
  const [outcome, setOutcome] = useState<CopyOutcome>("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(resetTimerRef.current ?? undefined), []);

  const copy = async () => {
    let copied = true;
    try {
      await navigator.clipboard.writeText(text());
    } catch {
      copied = false; // no clipboard (not a secure context) or permission refused
    }
    setOutcome(copied ? "copied" : "failed");
    clearTimeout(resetTimerRef.current ?? undefined);
    resetTimerRef.current = setTimeout(() => setOutcome("idle"), COPY_FEEDBACK_MS);
  };

  const labels: Record<CopyOutcome, string> = { idle: label, copied: "Copied", failed: "Couldn’t copy" };
  const announcements: Record<CopyOutcome, string> = { idle: "", copied: copiedAnnouncement, failed: failedAnnouncement };
  return (
    <>
      <button type="button" onClick={copy} aria-label={label} className={BUTTON_CLASS}>
        <span className="grid" aria-hidden="true">
          {(Object.keys(labels) as CopyOutcome[]).map((shown) => (
            <span key={shown} className={`col-start-1 row-start-1 ${shown === outcome ? "" : "invisible"}`}>
              {labels[shown]}
            </span>
          ))}
        </span>
      </button>
      <span role="status" className="sr-only" data-testid={statusTestId}>
        {announcements[outcome]}
      </span>
    </>
  );
}
