"use client";

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { urlForJump } from "@/lib/jumpUrl";
import { NEW_RECORD_SESSION, sessionAfterJump } from "@/lib/personalRecords";
import { usePrimeBuffer } from "@/lib/primes/usePrimeBuffer";
import { reportVisiblePrime, toggleFavorite, usePersonalData } from "@/lib/usePersonalData";
import { Cpu } from "./Cpu";
import fadingNotice from "./FadingNotice.module.scss";
import { JumpForm } from "./JumpForm";
import { PrimeList } from "./PrimeList";
import { FittedNumber } from "./FittedNumber";
import { useNumberPopover } from "./NumberPopover";

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Below 0.1 ms, the timer may not be precise enough to say more than that. */
function formatBatchDuration(durationMs: number | null): string {
  if (durationMs === null) return "—";
  return durationMs < 0.1 ? "< 0.1 ms" : `${durationMs.toFixed(2)} ms`;
}

/** Decimal units (1 MB = 10^6 bytes), as people read them. */
function formatMemory(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${numberFormatter.format(bytes / 1e6)} MB`;
  return `${numberFormatter.format(bytes / 1e3)} KB`;
}

function storedPrime(decimal: string | null): bigint | null {
  return decimal === null ? null : BigInt(decimal);
}

interface Props {
  intro: ReactNode;
  /** The first 500 primes, computed on the server so they're in the HTML. */
  firstBatchFromServer: readonly string[];
}

export function InfinitePrimes({ intro, firstBatchFromServer }: Props) {
  const {
    batches,
    status,
    primesPerSecond,
    heat,
    lastBatchDurationMs,
    lastBasePrimeSetupMs,
    lastVerificationMs,
    basePrimeMemoryBytes,
    sievingThreads,
    errorMessage,
    calculationIsSlow,
    reachedMemoryLimit,
    stop,
    lastJump,
    jumpTo,
    reportView,
    takeScrollInstruction,
  } = usePrimeBuffer(firstBatchFromServer);

  // --heat lives on the root element (see app/heat.scss) so the site nav
  // follows the counter too. Back to cool when leaving the page.
  useEffect(() => {
    document.documentElement.style.setProperty("--heat", String(heat));
  }, [heat]);
  useEffect(() => {
    return () => {
      document.documentElement.style.removeProperty("--heat");
    };
  }, []);

  const personalData = usePersonalData();
  const favoritePrimes = useMemo(
    () => new Set(personalData.data.favorites),
    [personalData.data.favorites],
  );

  // Whether scrolling still counts toward "furthest scroll" (only from 2, with no jump).
  const recordSessionRef = useRef(NEW_RECORD_SESSION);
  const handleLargestVisiblePrime = useCallback(
    (prime: bigint) => reportVisiblePrime(prime, recordSessionRef.current),
    [],
  );

  /** Every jump goes through here: the jump form, ?jump= links and favorites. */
  const handleJump = useCallback(
    (target: bigint) => {
      recordSessionRef.current = sessionAfterJump(target);
      jumpTo(target);
      // Make the URL shareable without reloading or adding a history entry per jump.
      window.history.replaceState(null, "", urlForJump(window.location.href, target));
    },
    [jumpTo],
  );

  // One popup for every shortened number on the page: the list's and the stats'.
  const { show: showFullNumber, popover: fullNumberPopover } = useNumberPopover();

  // The frontier is the largest prime currently held.
  const lastBatch = batches[batches.length - 1];
  const frontier = lastBatch ? lastBatch.primes[lastBatch.primes.length - 1] : null;
  const isBuildingBasePrimes = status === "building-base-primes";

  return (
    <main
      className={`mx-auto w-full max-w-3xl desktop:grid desktop:h-[calc(100dvh-var(--storage-notice-height))] desktop:max-w-6xl desktop:grid-cols-[minmax(20rem,28rem)_minmax(0,44rem)] desktop:grid-rows-[auto_auto_auto_1fr] desktop:justify-center desktop:gap-x-12 desktop:px-8`}
    >
      <div className="px-5 pt-6 pb-4 desktop:col-start-1 desktop:row-start-1 desktop:px-0 desktop:pt-10">
        {intro}
      </div>

      {/* One screen tall, minus the sticky mobile nav bar and the storage notice. */}
      <div className="flex h-[calc(100dvh-var(--mobile-nav-height)-var(--storage-notice-height))] flex-col desktop:contents">
        <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-rule px-5 py-4 desktop:col-start-1 desktop:row-start-2 desktop:px-0">
          <Cpu />
          <div className="min-w-40 flex-1">
            <div className="font-mono text-[clamp(2rem,8vw,3.75rem)] leading-none font-bold tabular-nums wrap-anywhere text-(--heat-text) transition-colors duration-600 desktop:text-[3.25rem]">
              {status === "stopped"
                ? "stopped"
                : primesPerSecond === null
                  ? "—"
                  : numberFormatter.format(primesPerSecond)}
            </div>
            <div className="flex min-h-11 items-center justify-between gap-3">
              <p aria-live="polite" className="text-xs tracking-widest text-muted uppercase">
                {isBuildingBasePrimes ? (
                  <span className="text-(--heat-text)">Building base primes…</span>
                ) : (
                  "primes per second"
                )}
              </p>
              {/* Always laid out, only shown during a slow calculation, so it never shifts the page. */}
              <button
                type="button"
                onClick={stop}
                aria-label="Stop calculating"
                className={`h-11 shrink-0 rounded-md border border-rule px-4 text-sm font-medium hover:border-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text) ${calculationIsSlow ? "" : "invisible"}`}
              >
                Stop
              </button>
            </div>
            <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[0.8rem] text-muted tabular-nums">
              <dt>frontier</dt>
              <dd className="min-w-0 text-foreground">
                <FittedNumber value={frontier} onShowFull={showFullNumber} />
              </dd>
              <dt>last batch</dt>
              <dd className="text-foreground">{formatBatchDuration(lastBatchDurationMs)}</dd>
              <dt>base primes</dt>
              <dd className="text-foreground">
                {lastBasePrimeSetupMs === null
                  ? "—"
                  : `set up in ${formatBatchDuration(lastBasePrimeSetupMs)}`}
              </dd>
              <dt>memory</dt>
              <dd className="text-foreground">
                {basePrimeMemoryBytes === null ? "—" : `${formatMemory(basePrimeMemoryBytes)} of base primes`}
              </dd>
              <dt>threads</dt>
              <dd className="text-foreground">{sievingThreads ?? "—"}</dd>
              <dt>checked</dt>
              <dd className="text-foreground">
                {lastVerificationMs === null ? "—" : `in ${formatBatchDuration(lastVerificationMs)}`}
              </dd>
              <dt>furthest scroll</dt>
              <dd className="flex min-w-0 items-baseline text-foreground">
                <FittedNumber
                  value={storedPrime(personalData.data.records.furthestScroll)}
                  onShowFull={showFullNumber}
                  className="flex-1"
                />
                {personalData.furthestScrollRecordBeaten && (
                  <span role="status" className={`${fadingNotice.fadingNotice} ml-2 shrink-0 text-(--heat-text)`}>
                    New record!
                  </span>
                )}
              </dd>
              <dt>biggest visited</dt>
              <dd className="min-w-0 text-foreground">
                <FittedNumber
                  value={storedPrime(personalData.data.records.biggestPrimeVisited)}
                  onShowFull={showFullNumber}
                />
              </dd>
            </dl>
            {fullNumberPopover}
            {personalData.storageIsFull && (
              <p role="status" className="mt-1 text-xs text-(--hot-text)">
                Your browser’s storage is full, so favorites and records aren’t being saved.
              </p>
            )}
          </div>
        </header>

        <div className="desktop:col-start-1 desktop:row-start-3">
          <JumpForm onJump={handleJump} lastJump={lastJump} />
        </div>

        <section
          aria-label="Prime numbers"
          className="flex min-h-0 flex-1 flex-col desktop:col-start-2 desktop:row-span-4 desktop:row-start-1 desktop:border-x desktop:border-rule"
        >
          <div className="min-h-0 flex-1">
            <PrimeList
              batches={batches}
              status={status}
              reachedMemoryLimit={reachedMemoryLimit}
              errorMessage={errorMessage}
              reportView={reportView}
              takeScrollInstruction={takeScrollInstruction}
              favoritePrimes={favoritePrimes}
              onToggleFavorite={toggleFavorite}
              onShowFullPrime={showFullNumber}
              onLargestVisiblePrime={handleLargestVisiblePrime}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
