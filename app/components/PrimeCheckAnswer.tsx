"use client";

import Link from "next/link";
import { useMemo } from "react";
import { shortNumber } from "@/lib/certificateCheck";
import { formatWholeNumber } from "@/lib/formatNumber";
import { formatDuration } from "@/lib/formatRate";
import { describeAnswer, describePosition, type PrimeCheckAnswer as Answer } from "@/lib/primeCheck";
import { isFavorite } from "@/lib/personalData";
import { toggleFavorite, usePersonalData } from "@/lib/usePersonalData";
import { CertificateSteps } from "./CertificateSteps";
import { CopyButton } from "./CopyButton";
import { StarIcon } from "./StarIcon";
import { WrappableNumber } from "./WrappableNumber";

/** Longer numbers aren't put in the address bar (browsers cap URLs at a few MB). */
export const MAX_DIGITS_IN_URL = 100_000;
/** A headline shortens a number past 8 digit groups (shortNumber): then it's shown in full too. */
const FULL_NUMBER_FROM_DIGITS = 25;
/** Longer numbers are shown in full only when opened, so the answer stays near the top. */
const MAX_DIGITS_SHOWN_OPEN = 100;

/** The answer's headline: the size of text-xl, no article heading margin, and a long number may wrap (it has no spaces). */
const HEADLINE_STYLE = { margin: 0, fontSize: "1.25rem", lineHeight: 1.4, overflowWrap: "anywhere" } as const;

/** The answer's actions: buttons and a link that looks like one. */
const ACTION_CLASS =
  "inline-flex h-11 items-center rounded-md border border-rule px-4 text-sm font-medium hover:border-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text)";
const ACTION_LINK_STYLE = { color: "var(--foreground)", textDecoration: "none" } as const;

interface Props {
  answer: Answer;
  /** How long it took in this browser; null while a proof runs or when the page was built with the answer. */
  elapsedMs: number | null;
  /** A listed number's note (lib/listedNumbers.ts). */
  note?: string;
}

/**
 * An answer with its evidence: the headline, the number in full, why, its place
 * in the list (a prime), the actions, and the certificate once proven. Used by
 * the checker (PrimeChecker) and, rendered at build time, by a listed number's
 * own page (app/is-prime/[n]).
 */
export function PrimeCheckAnswer({ answer, elapsedMs, note }: Props) {
  const { headline, explanation } = describeAnswer(answer);
  const digits = answer.value.toString().length;
  const certificate = answer.kind === "prime" && answer.proof.by === "certificate" ? answer.proof.steps : null;
  return (
    <div className="mt-2" data-testid="prime-check-result" data-kind={answer.kind}>
      {/* inline, to override the article's h2 margin and size (.prose h2), which outrank utilities */}
      <h2 style={HEADLINE_STYLE} className="font-semibold" data-testid="prime-check-headline">
        {headline}
      </h2>
      {digits >= FULL_NUMBER_FROM_DIGITS && digits <= MAX_DIGITS_SHOWN_OPEN && (
        <p className="mt-2 font-mono leading-snug break-words" data-testid="prime-check-value">
          <WrappableNumber value={answer.value} />
        </p>
      )}
      {digits > MAX_DIGITS_SHOWN_OPEN && (
        <details className="mt-2 rounded-md border border-rule px-3 py-2">
          <summary className="cursor-pointer text-sm">Show all {formatWholeNumber(BigInt(digits))} digits</summary>
          <p className="mt-2 font-mono text-sm leading-snug break-words" data-testid="prime-check-value">
            <WrappableNumber value={answer.value} />
          </p>
        </details>
      )}
      <p className="mt-2">{explanation}</p>
      {answer.kind === "prime" && <Position prime={answer.value} />}
      {note && (
        <p className="mt-2" data-testid="prime-check-note">
          {note}
        </p>
      )}
      {elapsedMs !== null && (
        <p className="mt-2 text-sm text-muted">
          {formatWholeNumber(BigInt(digits))} {digits === 1 ? "digit" : "digits"}, {certificate ? "proven" : "checked"} in{" "}
          {elapsedMs < 100 ? "under 0.1 s" : formatDuration(elapsedMs / 1000)}.
        </p>
      )}
      <AnswerActions answer={answer} />
      {certificate && <CertificateSteps prime={answer.value} steps={certificate} />}
    </div>
  );
}

/** Its place in the list. Counting can sieve up to 10 million, so it's done once per prime, not per render. */
function Position({ prime }: { prime: bigint }) {
  const position = useMemo(() => describePosition(prime), [prime]);
  return (
    <p className="mt-2" data-testid="prime-check-position">
      {position}
    </p>
  );
}

/** Favorite (a proven prime), Copy number, and the list at this number. */
function AnswerActions({ answer }: { answer: Answer }) {
  const { data, storageIsFull } = usePersonalData();
  const { value, kind } = answer;
  const shown = shortNumber(value);
  const favorite = kind === "prime" && isFavorite(data, value);
  const inList = value >= 2n && value.toString().length <= MAX_DIGITS_IN_URL;
  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2" data-testid="prime-check-actions">
        {kind === "prime" && (
          <button
            type="button"
            aria-pressed={favorite}
            aria-label={`Favorite ${shown}`}
            onClick={() => toggleFavorite(value)}
            className={`${ACTION_CLASS} gap-2 aria-pressed:text-(--heat-text)`}
          >
            <StarIcon filled={favorite} />
            <span aria-hidden="true">Favorite</span>
          </button>
        )}
        <CopyButton
          label="Copy number"
          text={() => value.toString()}
          copiedAnnouncement={`Copied ${shown}.`}
          failedAnnouncement="Couldn’t copy: the browser didn’t allow it."
          statusTestId="prime-check-copy-status"
        />
        {inList && (
          // inline, to override the article's link style (.prose a), which outranks utilities
          <Link href={`/?jump=${value}`} style={ACTION_LINK_STYLE} className={ACTION_CLASS}>
            {kind === "composite" || kind === "neither" ? "See the primes after it" : "Find it in the list"}
          </Link>
        )}
      </div>
      {storageIsFull && (
        <p role="status" className="mt-1 text-xs text-(--hot-text)">
          Your browser’s storage is full, so favorites aren’t being saved.
        </p>
      )}
    </>
  );
}
