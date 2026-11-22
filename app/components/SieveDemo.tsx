"use client";

import { useEffect, useState, type CSSProperties } from "react";
import {
  SIEVE_DEMO_LIMIT,
  SIEVE_DEMO_STEPS,
  SIEVE_DEMO_SURVIVORS,
  sieveDemoCaption,
  sieveDemoCells,
  type SieveDemoCell,
} from "@/lib/sieveDemo";
import styles from "./sieveDemos.module.scss";

/** How long Play waits between steps. */
const PLAY_STEP_MS = 2200;

/** What a screen reader hears for one number (the grid shows it with colour and a strike). */
function describeCell(cell: SieveDemoCell): string {
  switch (cell.state) {
    case "not-prime":
      return "1, not prime";
    case "crossed":
      return `${cell.value}, crossed off by ${cell.crossedOutBy}`;
    case "sieving-prime":
    case "prime":
      return `${cell.value}, prime`;
    default:
      return String(cell.value);
  }
}

/**
 * The sieve of Eratosthenes on 1 to 120, one prime at a time (lib/sieveDemo.ts):
 * Next step, Play/Pause and Reset. The caption is announced politely; each number
 * also says its state to screen readers. Under reduced motion, crossings are instant.
 */
export function SieveDemo() {
  const [step, setStep] = useState(0);
  const [playRequested, setPlayRequested] = useState(false);
  const finished = step >= SIEVE_DEMO_STEPS;
  const playing = playRequested && !finished;
  const cells = sieveDemoCells(step);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(
      () => {
        const next = step + 1;
        setStep(next);
        if (next >= SIEVE_DEMO_STEPS) setPlayRequested(false);
      },
      step === 0 ? 0 : PLAY_STEP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [playing, step]);

  return (
    <figure className={styles.demo} data-testid="sieve-demo">
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            setPlayRequested(false);
            setStep((current) => Math.min(current + 1, SIEVE_DEMO_STEPS));
          }}
          disabled={finished}
        >
          Next step
        </button>
        <button
          type="button"
          className={styles.button}
          aria-pressed={playing}
          onClick={() => setPlayRequested(!playing)}
          disabled={finished}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            setPlayRequested(false);
            setStep(0);
          }}
          disabled={step === 0}
        >
          Reset
        </button>
      </div>

      <ol className={styles.grid} aria-label={`The numbers from 1 to ${SIEVE_DEMO_LIMIT}`}>
        {cells.map((cell) => (
          <li
            key={cell.value}
            className={[styles.cell, styles[cell.state], cell.justCrossed ? styles.justCrossed : ""].join(" ")}
            style={
              {
                "--order": cell.orderInStep,
                ...(cell.colorIndex === null ? {} : { "--prime-color": `var(--sieve-prime-${cell.colorIndex})` }),
              } as CSSProperties
            }
            data-state={cell.state}
            data-crossed-out-by={cell.crossedOutBy ?? undefined}
          >
            <span aria-hidden="true">{cell.value}</span>
            <span className="sr-only">{describeCell(cell)}</span>
          </li>
        ))}
      </ol>

      <figcaption>
        {/* Every caption is laid out, invisibly, in the same cell as the live one, so the
            space is always the longest's at any width and stepping never moves the page. */}
        <div className={styles.captionArea}>
          {Array.from({ length: SIEVE_DEMO_STEPS + 1 }, (_, captionStep) => (
            <span key={captionStep} className="invisible" aria-hidden="true">
              {sieveDemoCaption(captionStep)}
            </span>
          ))}
          <p aria-live="polite" data-testid="sieve-demo-caption">
            {sieveDemoCaption(step)}
          </p>
        </div>
        {/* Always laid out, shown at the end, so finishing doesn't push the page down. */}
        <p className={`${styles.survivors} ${finished ? "" : "invisible"}`} data-testid="sieve-demo-primes">
          The primes up to {SIEVE_DEMO_LIMIT}: {SIEVE_DEMO_SURVIVORS.join(", ")}.
        </p>
      </figcaption>
    </figure>
  );
}
