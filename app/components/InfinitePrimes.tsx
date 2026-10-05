"use client";

import type { CSSProperties, ReactNode } from "react";
import { heatFromRate, usePrimeBuffer } from "@/lib/primes/usePrimeBuffer";
import { Cpu } from "./Cpu";
import { JumpForm } from "./JumpForm";
import { PrimeList } from "./PrimeList";
import heatStyles from "./heat.module.scss";

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

interface Props {
  intro: ReactNode;
}

export function InfinitePrimes({ intro }: Props) {
  const {
    batches,
    status,
    primesPerSecond,
    lastBatchDurationMs,
    lastJump,
    jumpTo,
    reportView,
    takeScrollInstruction,
  } = usePrimeBuffer();
  const heat = heatFromRate(primesPerSecond);

  // The frontier is the largest prime currently held.
  const lastBatch = batches[batches.length - 1];
  const frontier = lastBatch ? lastBatch.primes[lastBatch.primes.length - 1] : 0;

  return (
    <main
      className={`${heatStyles.root} mx-auto w-full max-w-3xl desktop:grid desktop:h-dvh desktop:max-w-6xl desktop:grid-cols-[minmax(20rem,28rem)_minmax(0,44rem)] desktop:grid-rows-[auto_auto_auto_1fr] desktop:justify-center desktop:gap-x-12 desktop:px-8`}
      style={{ "--heat": heat } as CSSProperties}
    >
      <div className="px-5 pt-6 pb-4 desktop:col-start-1 desktop:row-start-1 desktop:px-0 desktop:pt-10">
        {intro}
      </div>

      <div className="flex h-dvh flex-col desktop:contents">
        <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-rule px-5 py-4 desktop:col-start-1 desktop:row-start-2 desktop:px-0">
          <Cpu />
          <div className="min-w-40 flex-1">
            <div className="font-mono text-[clamp(2rem,8vw,3.75rem)] leading-none font-bold tabular-nums wrap-anywhere text-(--heat-color) transition-colors duration-600 desktop:text-[3.25rem]">
              {primesPerSecond ? numberFormatter.format(primesPerSecond) : "—"}
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
              <dd className="text-foreground">{lastBatchDurationMs.toFixed(2)} ms</dd>
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
          {status === "overflow" && (
            <div className="bg-(--hot) px-5 py-3 text-white">
              <strong>You broke math.</strong> The next prime is past 2⁵³ − 1, where
              JavaScript numbers stop being exact integers.
            </div>
          )}
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
