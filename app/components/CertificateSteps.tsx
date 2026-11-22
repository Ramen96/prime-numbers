"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { certificateFileName, certificateJson, certificateText } from "@/lib/certificateExport";
import { formatWholeNumber } from "@/lib/formatNumber";
import type { CertificateStep } from "@/lib/primes/primalityCertificate";
import { WrappableNumber } from "./WrappableNumber";

interface Props {
  prime: bigint;
  steps: readonly CertificateStep[];
}

/** The downloads look like the site's buttons, not like links in the text. */
const DOWNLOAD_LINK_STYLE = { color: "var(--foreground)", textDecoration: "none" } as const;
const BUTTON_CLASS =
  "inline-flex h-11 items-center rounded-md border border-rule px-4 text-sm font-medium hover:border-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text)";

/** How long “Copied” (or “Couldn’t copy”) shows before the button reads “Copy as text” again. */
const COPY_FEEDBACK_MS = 2_000;

const digitsOf = (value: bigint) => formatWholeNumber(BigInt(value.toString().length));

/** One labelled number of a step, in full, wrapping at its commas. */
function StepNumber({ name, value }: { name: string; value: bigint }) {
  return (
    <>
      <dt className="font-mono text-muted">{name}</dt>
      <dd className="min-w-0 font-mono break-words">
        <WrappableNumber value={value} />
      </dd>
    </>
  );
}

/** Object URLs for the two downloads, made once per certificate and released after. */
function useDownloadUrls(prime: bigint, steps: readonly CertificateStep[]) {
  const [urls, setUrls] = useState<{ json: string; text: string } | null>(null);
  useEffect(() => {
    const json = URL.createObjectURL(new Blob([certificateJson(prime, steps)], { type: "application/json" }));
    const text = URL.createObjectURL(new Blob([certificateText(prime, steps)], { type: "text/plain" }));
    setUrls({ json, text }); // eslint-disable-line react-hooks/set-state-in-effect -- object URLs exist only in the browser
    return () => {
      URL.revokeObjectURL(json);
      URL.revokeObjectURL(text);
    };
  }, [prime, steps]);
  return urls;
}

type CopyOutcome = "idle" | "copied" | "failed";

const COPY_LABELS: Record<CopyOutcome, string> = { idle: "Copy as text", copied: "Copied", failed: "Couldn’t copy" };
const COPY_ANNOUNCEMENTS: Record<CopyOutcome, string> = {
  idle: "",
  copied: "Copied the certificate as text.",
  failed: "Couldn’t copy: the browser didn’t allow it. Download it as text instead.",
};

/**
 * Copies the text download to the clipboard. Every label is stacked in one grid
 * cell, so the button keeps its width; the outcome is announced separately, and
 * the button's own name stays “Copy as text”.
 */
function CopyAsTextButton({ prime, steps }: Props) {
  const [outcome, setOutcome] = useState<CopyOutcome>("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(resetTimerRef.current ?? undefined), []);

  const copy = async () => {
    let copied = true;
    try {
      await navigator.clipboard.writeText(certificateText(prime, steps));
    } catch {
      copied = false; // no clipboard (not a secure context) or permission refused
    }
    setOutcome(copied ? "copied" : "failed");
    clearTimeout(resetTimerRef.current ?? undefined);
    resetTimerRef.current = setTimeout(() => setOutcome("idle"), COPY_FEEDBACK_MS);
  };

  return (
    <>
      <button type="button" onClick={copy} aria-label="Copy as text" className={BUTTON_CLASS}>
        <span className="grid" aria-hidden="true">
          {(Object.keys(COPY_LABELS) as CopyOutcome[]).map((label) => (
            <span key={label} className={`col-start-1 row-start-1 ${label === outcome ? "" : "invisible"}`}>
              {COPY_LABELS[label]}
            </span>
          ))}
        </span>
      </button>
      <span role="status" className="sr-only" data-testid="certificate-copy-status">
        {COPY_ANNOUNCEMENTS[outcome]}
      </span>
    </>
  );
}

/**
 * A prime's elliptic curve certificate, as the checker accepted it: one
 * collapsible step per number in the chain, then the two downloads and a copy button.
 */
export function CertificateSteps({ prime, steps }: Props) {
  const urls = useDownloadUrls(prime, steps);
  const last = steps.at(-1);
  return (
    <div className="mt-6" data-testid="certificate">
      <h2 className="mb-2 text-lg font-semibold">Its certificate</h2>
      <p className="mb-3 text-sm text-muted">
        Each step gives a number N, a curve y² = x³ + ax + b (mod N), a point (x, y) on it, and a prime q: the
        point times q is the point at infinity, and q is larger than (N<sup>¼</sup> + 1)², so if q is prime, N is
        too. Each q is the next step’s N, down to {last ? digitsOf(last.orderPrime) : "a few"} digits, below 3.3 ×
        10²⁴, where Miller–Rabin settles it.{" "}
        <Link href="/how-it-works#proving-huge-primes" className="text-(--heat-text) underline underline-offset-2">
          How the proof works
        </Link>
      </p>
      {/* inline, to override the article's list and link styles (.prose ol, .prose a), which outrank utilities */}
      <ol className="space-y-2" style={{ listStyle: "none", paddingLeft: 0 }} data-testid="certificate-steps">
        {steps.map((step, index) => (
          <li key={index}>
            <details className="rounded-md border border-rule px-3 py-2">
              <summary className="cursor-pointer text-sm">
                Step {index + 1} of {steps.length}: N has {digitsOf(step.number)} digits, q has {digitsOf(step.orderPrime)}
              </summary>
              <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                <StepNumber name="N" value={step.number} />
                <StepNumber name="a" value={step.curveA} />
                <StepNumber name="b" value={step.curveB} />
                <StepNumber name="x" value={step.pointX} />
                <StepNumber name="y" value={step.pointY} />
                <StepNumber name="q" value={step.orderPrime} />
              </dl>
            </details>
          </li>
        ))}
      </ol>
      <p className="mt-4 flex flex-wrap gap-2">
        {urls && (
          <>
            <a
              style={DOWNLOAD_LINK_STYLE}
              href={urls.json}
              download={certificateFileName(prime, "json")}
              className={BUTTON_CLASS}
            >
              Download as JSON
            </a>
            <a
              style={DOWNLOAD_LINK_STYLE}
              href={urls.text}
              download={certificateFileName(prime, "txt")}
              className={BUTTON_CLASS}
            >
              Download as text
            </a>
            <CopyAsTextButton prime={prime} steps={steps} />
          </>
        )}
      </p>
    </div>
  );
}
