"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_DEPTH,
  DEPTH_LEVELS,
  DEPTH_STORAGE_KEY,
  depthAnnouncement,
  initialDepth,
  urlWithDepth,
  type DepthLevel,
} from "@/lib/howItWorksDepth";

/** Opens every section's levels up to `level` and closes the rest (DepthSection.tsx). */
function openTo(level: DepthLevel): void {
  for (const details of document.querySelectorAll<HTMLDetailsElement>("details[data-depth]"))
    details.open = Number(details.dataset.depth) <= level;
}

function savedDepth(): string | null {
  try {
    return window.localStorage.getItem(DEPTH_STORAGE_KEY);
  } catch {
    return null; // storage blocked: the default
  }
}

/** Opens the levels around the address's #anchor, so a link into a deeper level lands on it. */
function revealAnchor(): void {
  const id = decodeURIComponent(window.location.hash.slice(1));
  const target = id ? document.getElementById(id) : null;
  if (!target) return;
  let closed = false;
  for (let element = target.parentElement; element; element = element.parentElement)
    if (element instanceof HTMLDetailsElement && !element.open) {
      element.open = true;
      closed = true;
    }
  if (closed) target.scrollIntoView();
}

const subscribeToNothing = () => () => {};

/**
 * How deep every section of /how-it-works opens: a radio group of the four
 * levels. Choosing one opens and closes every section's levels to match, says
 * so to screen readers, keeps it in ?level= (so it can be shared) and remembers
 * it in this browser. A ?level= link applies to that visit only. Each section's
 * levels still open and close on their own. Without JavaScript the switch could
 * do nothing, so it stays hidden; the inline script (APPLY_DEPTH_SCRIPT) shows it.
 */
export function DepthSwitch() {
  const hydrated = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    // the inline script has opened the levels already; mark the reader's level as chosen
    const level = initialDepth(window.location.search, savedDepth());
    const choice = document.querySelector<HTMLInputElement>(`#depth-switch input[value="${level}"]`);
    if (choice) choice.checked = true;
    revealAnchor();
    window.addEventListener("hashchange", revealAnchor);
    return () => window.removeEventListener("hashchange", revealAnchor);
  }, []);

  const choose = (level: DepthLevel) => {
    openTo(level);
    try {
      window.localStorage.setItem(DEPTH_STORAGE_KEY, String(level));
    } catch {
      // storage blocked or full: it applies for this visit only
    }
    window.history.replaceState(null, "", urlWithDepth(window.location.href, level));
    setAnnouncement(depthAnnouncement(level));
  };

  return (
    <fieldset id="depth-switch" hidden={!hydrated} suppressHydrationWarning className="my-8" data-testid="depth-switch">
      <legend className="mb-2 text-sm font-semibold">How deep</legend>
      <div className="grid grid-cols-2 gap-2 min-[40rem]:grid-cols-4">
        {DEPTH_LEVELS.map(({ level, name }) => (
          <label
            key={level}
            className="flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-rule px-3 py-1 text-center text-sm leading-tight hover:border-foreground has-checked:border-(--heat-text) has-checked:font-semibold has-focus-visible:outline-2 has-focus-visible:outline-(--heat-text)"
          >
            <input type="radio" name="depth" value={level} defaultChecked={level === DEFAULT_DEPTH} onChange={() => choose(level)} className="sr-only" />
            {name}
          </label>
        ))}
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </fieldset>
  );
}
