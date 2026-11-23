"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { certificateFileName, certificateJson, certificateText } from "@/lib/certificateExport";
import { formatWholeNumber } from "@/lib/formatNumber";
import type { CertificateStep } from "@/lib/primes/primalityCertificate";
import { CopyButton } from "./CopyButton";
import { WrappableNumber } from "./WrappableNumber";

interface Props {
  prime: bigint;
  steps: readonly CertificateStep[];
  /** The certificate checker is further down this same page (/random-prime), so “Check it yourself” stays here. */
  checkerOnThisPage?: boolean;
}

/** The certificate checker (CertificateCheck): one, on /random-prime. */
const CERTIFICATE_CHECKER_PATH = "/random-prime#check-a-certificate";

/** The downloads look like the site's buttons, not like links in the text. */
const DOWNLOAD_LINK_STYLE = { color: "var(--foreground)", textDecoration: "none" } as const;
const BUTTON_CLASS =
  "inline-flex h-11 items-center rounded-md border border-rule px-4 text-sm font-medium hover:border-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text)";

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

/**
 * A prime's elliptic curve certificate, as the checker accepted it: what a
 * certificate proves, in plain words; the two downloads, a copy button and a link
 * to the checker, before the steps so a long chain can't push them out of sight;
 * then the technical summary and one collapsible step per number in the chain.
 */
export function CertificateSteps({ prime, steps, checkerOnThisPage = false }: Props) {
  const urls = useDownloadUrls(prime, steps);
  const last = steps.at(-1);
  return (
    <div className="mt-6" data-testid="certificate">
      <h2 className="mb-2 text-lg font-semibold">Its certificate</h2>
      <p className="mb-3" data-testid="certificate-explanation">
        This certificate is the proof, written out so you can check it. Each step shows that if a smaller number is
        prime, so is a bigger one, and the chain ends at a number small enough to settle directly. Finding the steps
        took the time; checking them is far quicker. So you don’t have to trust the program that found them: the
        download has every number, and anyone can check it, with this site’s checker or a program of their own.
      </p>
      <p className="mb-4 flex flex-wrap items-center gap-2" data-testid="certificate-actions">
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
            <CopyButton
              label="Copy as text"
              text={() => certificateText(prime, steps)}
              copiedAnnouncement="Copied the certificate as text."
              failedAnnouncement="Couldn’t copy: the browser didn’t allow it. Download it as text instead."
              statusTestId="certificate-copy-status"
            />
          </>
        )}
        {/* a link, in the build's HTML too; inline-flex and h-11 make it a 44 px target like the buttons */}
        <Link
          href={checkerOnThisPage ? "#check-a-certificate" : CERTIFICATE_CHECKER_PATH}
          className="inline-flex h-11 items-center px-1 text-sm text-(--heat-text) underline underline-offset-2"
        >
          Check it yourself →
        </Link>
      </p>
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
    </div>
  );
}
