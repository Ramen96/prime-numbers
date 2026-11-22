"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { andList } from "@/lib/listText";
import { segmentCaption, segmentCells, segmentWindow, type SegmentCell } from "@/lib/segmentDemo";
import shared from "./sieveDemos.module.scss";
import styles from "./SegmentDemo.module.scss";

/** How long Play waits between steps (the same pace as the first demo). */
const PLAY_STEP_MS = 2200;
/** Colours defined in sieveDemos.module.scss; base primes past them reuse them in turn. */
const PRIME_COLORS = 6;

const primeColor = (colorIndex: number) => `var(--sieve-prime-${colorIndex % PRIME_COLORS})`;

/** What a screen reader hears for one number (the grid shows it with strikes). */
function describeCell(cell: SegmentCell): string {
  if (cell.state === "crossed") return `${cell.value}, crossed off by ${andList(cell.crossedBy.map((mark) => mark.prime))}`;
  if (cell.state === "prime") return `${cell.value}, prime`;
  return String(cell.value);
}

/**
 * The segmented sieve, one 20-number window at a time (lib/segmentDemo.ts): each
 * base prime lands at low mod p and marks every multiple from there, struck again
 * where a smaller prime already marked it. Next step, Play/Pause, Next window, Reset.
 */
export function SegmentDemo() {
  const [windowIndex, setWindowIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [playRequested, setPlayRequested] = useState(false);
  const shownWindow = useMemo(() => segmentWindow(windowIndex), [windowIndex]);
  const finished = step >= shownWindow.steps;
  const playing = playRequested && !finished;
  const cells = segmentCells(shownWindow, step);
  const currentPass = step >= 1 && step <= shownWindow.passes.length ? shownWindow.passes[step - 1] : null;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(
      () => {
        const next = step + 1;
        setStep(next);
        if (next >= shownWindow.steps) setPlayRequested(false);
      },
      step === 0 ? 0 : PLAY_STEP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [playing, step, shownWindow.steps]);

  const moveTo = (index: number) => {
    setPlayRequested(false);
    setWindowIndex(index);
    setStep(0);
  };

  return (
    // both stylesheets' .demo: each module hashes its own class name
    <figure className={`${shared.demo} ${styles.demo}`} data-testid="segment-demo">
      <div className={shared.controls}>
        <button
          type="button"
          className={shared.button}
          onClick={() => {
            setPlayRequested(false);
            setStep((current) => Math.min(current + 1, shownWindow.steps));
          }}
          disabled={finished}
        >
          Next step
        </button>
        <button
          type="button"
          className={shared.button}
          aria-pressed={playing}
          onClick={() => setPlayRequested(!playing)}
          disabled={finished}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className={shared.button} onClick={() => moveTo(windowIndex + 1)}>
          Next window
        </button>
        <button type="button" className={shared.button} onClick={() => moveTo(0)} disabled={windowIndex === 0 && step === 0}>
          Reset
        </button>
      </div>

      <ul className={styles.basePrimes} aria-label="Base primes" data-testid="segment-demo-base-primes">
        <li aria-hidden="true">base primes:</li>
        {shownWindow.passes.map((pass) => (
          <li
            key={pass.prime}
            className={`${styles.basePrime} ${currentPass?.prime === pass.prime ? styles.currentBasePrime : ""}`}
            style={{ "--prime-color": primeColor(pass.colorIndex) } as CSSProperties}
            aria-current={currentPass?.prime === pass.prime ? "step" : undefined}
          >
            {pass.prime}
          </li>
        ))}
      </ul>

      <ol className={shared.grid} aria-label={`The numbers from ${shownWindow.low} to ${shownWindow.high - 1}`}>
        {cells.map((cell) => (
          <li
            key={cell.value}
            className={[shared.cell, cell.state === "prime" ? shared.prime : "", cell.state === "crossed" ? styles.marked : ""].join(" ")}
            data-state={cell.state}
            data-crossed-by={cell.crossedBy.map((mark) => mark.prime).join(" ") || undefined}
          >
            <span aria-hidden="true">{cell.value}</span>
            {cell.crossedBy.map((mark, index) => (
              <span
                key={mark.prime}
                aria-hidden="true"
                className={`${styles.strike} ${cell.justCrossed && index === cell.crossedBy.length - 1 ? styles.newStrike : ""}`}
                style={
                  {
                    "--prime-color": primeColor(mark.colorIndex),
                    "--strike-index": index,
                    "--order": cell.orderInStep,
                  } as CSSProperties
                }
              />
            ))}
            <span className="sr-only">{describeCell(cell)}</span>
          </li>
        ))}
      </ol>

      <figcaption>
        {/* Every caption of this window, invisibly in one cell with the live one, so stepping never moves the page. */}
        <div className={shared.captionArea}>
          {Array.from({ length: shownWindow.steps + 1 }, (_, captionStep) => (
            <span key={captionStep} className="invisible" aria-hidden="true">
              {segmentCaption(shownWindow, captionStep)}
            </span>
          ))}
          <p aria-live="polite" data-testid="segment-demo-caption">
            {segmentCaption(shownWindow, step)}
          </p>
        </div>
      </figcaption>
    </figure>
  );
}
