"use client";

import { useEffect, type ReactNode } from "react";
import { usePrimeBuffer } from "@/lib/primes/usePrimeBuffer";
import { Cpu } from "./Cpu";
import { JumpForm } from "./JumpForm";
import { PrimeList } from "./PrimeList";

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Below 0.1 ms, the timer may not be precise enough to say more than that. */
function formatBatchDuration(durationMs: number | null): string {
  if (durationMs === null) return "—";
  return durationMs < 0.1 ? "< 0.1 ms" : `${durationMs.toFixed(2)} ms`;
}

interface Props {
  intro: ReactNode;
  /** The first 500 primes, computed on the server so they're in the HTML. */
  firstBatchFromServer: readonly number[];
}

export function InfinitePrimes({ intro, firstBatchFromServer }: Props) {
  const {
    batches,
    status,
    primesPerSecond,
    heat,
    lastBatchDurationMs,
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

  // The frontier is the largest prime currently held.
  const lastBatch = batches[batches.length - 1];
  const frontier = lastBatch ? lastBatch.primes[lastBatch.primes.length - 1] : 0;

  return (
    <main
      className={`mx-auto w-full max-w-3xl desktop:grid desktop:h-dvh desktop:max-w-6xl desktop:grid-cols-[minmax(20rem,28rem)_minmax(0,44rem)] desktop:grid-rows-[auto_auto_auto_1fr] desktop:justify-center desktop:gap-x-12 desktop:px-8`}
    >
      <div className="px-5 pt-6 pb-4 desktop:col-start-1 desktop:row-start-1 desktop:px-0 desktop:pt-10">
        {intro}
      </div>

      {/* One screen tall, minus the sticky mobile nav bar. */}
      <div className="flex h-[calc(100dvh-var(--mobile-nav-height))] flex-col desktop:contents">
        <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-rule px-5 py-4 desktop:col-start-1 desktop:row-start-2 desktop:px-0">
          <Cpu />
          <div className="min-w-40 flex-1">
            <div className="font-mono text-[clamp(2rem,8vw,3.75rem)] leading-none font-bold tabular-nums wrap-anywhere text-(--heat-text) transition-colors duration-600 desktop:text-[3.25rem]">
              {primesPerSecond === null ? "—" : numberFormatter.format(primesPerSecond)}
            </div>
            <div className="mt-1 text-xs tracking-widest text-muted uppercase">
              primes per second
            </div>
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[0.8rem] text-muted tabular-nums">
              <dt>frontier</dt>
              <dd className="text-foreground">
                {frontier ? numberFormatter.format(frontier) : "—"}
              </dd>
              <dt>last batch</dt>
              <dd className="text-foreground">{formatBatchDuration(lastBatchDurationMs)}</dd>
            </dl>
          </div>
        </header>

        <div className="desktop:col-start-1 desktop:row-start-3">
          <JumpForm onJump={jumpTo} lastJump={lastJump} />
        </div>

        <section
          aria-label="Prime numbers"
          className="flex min-h-0 flex-1 flex-col desktop:col-start-2 desktop:row-span-4 desktop:row-start-1 desktop:border-x desktop:border-rule"
        >
          <div className="min-h-0 flex-1">
            <PrimeList
              batches={batches}
              status={status}
              reportView={reportView}
              takeScrollInstruction={takeScrollInstruction}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
