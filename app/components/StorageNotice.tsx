"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef } from "react";
import { DATA_FAQ_LINK } from "@/lib/faqAnchors";
import { dismissStorageNotice, markStorageNoticeSeen, usePersonalData } from "@/lib/usePersonalData";

/**
 * A small, dismissible note about what the site keeps in this browser.
 * Informational, not a consent wall: nothing waits for it. It appears only
 * after mount (never in the server HTML), on the first visit only.
 *
 * It sits fixed at the bottom of the screen and publishes its height as
 * --storage-notice-height, which the page layouts subtract, so it never covers
 * anything. It only ever changes where the page ends, never where it starts,
 * so showing or dismissing it doesn't move the visible primes.
 */
export function StorageNotice() {
  const { showStorageNotice } = usePersonalData();
  const noticeRef = useRef<HTMLDivElement>(null);

  // Once it's on screen, don't show it on later visits, whether or not OK is clicked.
  useEffect(() => {
    if (showStorageNotice) markStorageNoticeSeen();
  }, [showStorageNotice]);

  // A layout effect, so the space is reserved (and released) before the browser paints.
  useLayoutEffect(() => {
    const notice = noticeRef.current;
    if (!notice) return;
    const rootStyle = document.documentElement.style;
    const publishHeight = () => rootStyle.setProperty("--storage-notice-height", `${notice.offsetHeight}px`);
    publishHeight();
    const resizeObserver = new ResizeObserver(publishHeight);
    resizeObserver.observe(notice);
    return () => {
      resizeObserver.disconnect();
      rootStyle.removeProperty("--storage-notice-height");
    };
  }, [showStorageNotice]);

  if (!showStorageNotice) return null;

  return (
    <div
      ref={noticeRef}
      role="region"
      aria-label="Storage notice"
      className="fixed inset-x-0 bottom-0 z-30 bg-foreground text-background"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2 text-[0.8rem] leading-snug sm:gap-5 sm:px-5 sm:text-sm">
        <p className="min-w-0 flex-1">
          This site saves your favorite primes and scroll records in your browser so they’re
          there next time. Nothing is sent anywhere: no tracking, no analytics.{" "}
          {/* An inline link in a sentence: exempt from the target-size minimum (WCAG 2.5.8). */}
          <Link
            href={DATA_FAQ_LINK}
            className="whitespace-nowrap underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-background"
          >
            Learn more<span className="sr-only"> about what this site stores</span>
          </Link>
        </p>
        <button
          type="button"
          onClick={dismissStorageNotice}
          className="h-11 shrink-0 rounded-md bg-background px-5 font-medium text-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-background"
        >
          OK
        </button>
      </div>
    </div>
  );
}
