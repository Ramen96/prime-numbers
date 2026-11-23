"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type SubmitEvent } from "react";
import { shortNumber } from "@/lib/certificateCheck";
import { formatWholeNumber } from "@/lib/formatNumber";
import { formatDuration } from "@/lib/formatRate";
import {
  describeAnswer,
  describePosition,
  describeProofTime,
  estimatedProofSeconds,
  HUGE_PROOF_SECONDS,
  parseNumberToCheck,
  type PrimeCheckAnswer,
} from "@/lib/primeCheck";
import { usePrimeCheck, type PrimeCheckState } from "@/lib/primes/usePrimeCheck";
import { isFavorite } from "@/lib/personalData";
import { describeProving } from "@/lib/provingStatus";
import { toggleFavorite, usePersonalData } from "@/lib/usePersonalData";
import { CertificateSteps } from "./CertificateSteps";
import { CopyButton } from "./CopyButton";
import { StarIcon } from "./StarIcon";
import { WrappableNumber } from "./WrappableNumber";

/** Longer numbers aren't put in the address bar (browsers cap URLs at a few MB). */
const MAX_DIGITS_IN_URL = 100_000;
/** A headline shortens a number past 8 digit groups (shortNumber): then it's shown in full too. */
const FULL_NUMBER_FROM_DIGITS = 25;
/** Longer numbers are shown in full only when opened, so the answer stays near the top. */
const MAX_DIGITS_SHOWN_OPEN = 100;
/** The checking row shows the time from this long on. */
const SHOW_CHECKING_TIME_AFTER_MS = 1000;

/** The answer's headline: the size of text-xl, no article heading margin, and a long number may wrap (it has no spaces). */
const HEADLINE_STYLE = { margin: 0, fontSize: "1.25rem", lineHeight: 1.4, overflowWrap: "anywhere" } as const;

/** The answer's actions: buttons and a link that looks like one. */
const ACTION_CLASS =
  "inline-flex h-11 items-center rounded-md border border-rule px-4 text-sm font-medium hover:border-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text)";
const ACTION_LINK_STYLE = { color: "var(--foreground)", textDecoration: "none" } as const;

const BUTTON_CLASS =
  "h-11 rounded-md border border-rule px-4 text-sm font-medium hover:border-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text) disabled:text-muted";

/** The number in the address bar (`?n=`), read as the box reads it, or null. */
function numberInAddress(): { typed: string; value: bigint } | null {
  const typed = new URLSearchParams(window.location.search).get("n");
  if (typed === null) return null;
  const parsed = parseNumberToCheck(typed);
  return parsed.valid ? { typed, value: parsed.target } : null;
}

/** How long the current check has run, ticking once a second while it does. */
function useCheckingTime(checking: boolean): number {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!checking) return;
    const started = performance.now();
    setElapsedMs(0); // eslint-disable-line react-hooks/set-state-in-effect -- a new check starts its clock at 0
    const timer = setInterval(() => setElapsedMs(performance.now() - started), 1000);
    return () => clearInterval(timer);
  }, [checking]);
  return elapsedMs;
}

/** The status line: what's running, or why nothing is shown. */
function statusText(state: PrimeCheckState, checkingMs: number): string {
  switch (state.kind) {
    case "checking":
      return checkingMs >= SHOW_CHECKING_TIME_AFTER_MS ? `checking… ${formatDuration(checkingMs / 1000)}` : "checking…";
    case "proving":
      return describeProving(state.proving);
    case "gave-up":
      return state.answer ? "Gave up on the proof. “Prove it” carries on where it stopped." : "Gave up on that one.";
    case "memory-limit":
      return `This device ran out of memory before ${shortNumber(state.value)} could be settled.`;
    case "disputed":
      return state.stage === "check"
        ? `Stopped. The answer for ${shortNumber(state.value)} didn’t hold when this page checked it again, so it isn’t shown. That’s a bug in this site, not a fact about the number.`
        : `Stopped. The certificate made for ${shortNumber(state.value)} didn’t pass the checker, so it isn’t shown as proven. That’s a bug in this site, not a fact about the number.`;
    case "error":
      return `Stopped. ${state.message}`;
    default:
      return "";
  }
}

/** The answer on show, and how long it took (null while a proof is running or was given up on). */
function shownAnswer(state: PrimeCheckState): { answer: PrimeCheckAnswer; elapsedMs: number | null } | null {
  if (state.kind === "answered") return { answer: state.answer, elapsedMs: state.elapsedMs };
  if (state.kind === "proving") return { answer: state.answer, elapsedMs: null };
  if (state.kind === "gave-up" && state.answer) return { answer: state.answer, elapsedMs: null };
  return null;
}

function Answer({ answer, elapsedMs }: { answer: PrimeCheckAnswer; elapsedMs: number | null }) {
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
function AnswerActions({ answer }: { answer: PrimeCheckAnswer }) {
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

/** What a proof of this probable prime would take, said before it starts. */
function ProofEstimate({ digits }: { digits: number }) {
  const seconds = estimatedProofSeconds(digits);
  return (
    <p className="mt-2 text-sm text-muted" data-testid="prime-check-estimate">
      A proof of a {formatWholeNumber(BigInt(digits))}-digit number takes {describeProofTime(seconds)} on a laptop; a
      phone is slower.
      {seconds >= HUGE_PROOF_SECONDS && " That’s a big number. The page will try, and “Give up” is right there."}
    </p>
  );
}

/**
 * The prime checker (/is-prime): a number in, an answer out with its evidence,
 * and for a probable prime past 3.3 × 10^24, “Prove it”. The number goes in the
 * address bar (`?n=`), so an answer can be shared and the back button works.
 */
export function PrimeChecker() {
  const { state, check, prove, giveUp } = usePrimeCheck();
  const [typedNumber, setTypedNumber] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const checkingMs = useCheckingTime(state.kind === "checking");
  const running = state.kind === "checking" || state.kind === "proving";

  // the address bar's number, on arrival and on back and forward
  useEffect(() => {
    const checkAddress = () => {
      const fromAddress = numberInAddress();
      if (!fromAddress) return;
      setTypedNumber(fromAddress.typed);
      setInputError(null);
      check(fromAddress.value);
    };
    checkAddress();
    window.addEventListener("popstate", checkAddress);
    return () => window.removeEventListener("popstate", checkAddress);
  }, [check]);

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const parsed = parseNumberToCheck(typedNumber);
    if (!parsed.valid) {
      setInputError(parsed.message);
      return;
    }
    setInputError(null);
    const digits = parsed.target.toString();
    const address = digits.length <= MAX_DIGITS_IN_URL ? `/is-prime?n=${digits}` : "/is-prime";
    if (window.location.pathname + window.location.search !== address) window.history.pushState(null, "", address);
    check(parsed.target);
  };

  const shown = shownAnswer(state);
  const canProve = shown?.answer.kind === "probably-prime" && state.kind !== "proving";

  return (
    <section className="my-6" data-testid="prime-checker">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 grow flex-col text-sm">
          <span className="mb-1 text-muted">Number</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={typedNumber}
            onChange={(event) => setTypedNumber(event.target.value)}
            aria-invalid={inputError !== null}
            aria-describedby="prime-check-feedback"
            className="h-11 w-full min-w-0 rounded-md border border-rule bg-background px-3 font-mono focus-visible:outline-2 focus-visible:outline-(--heat-text)"
          />
        </label>
        <button type="submit" className={BUTTON_CLASS}>
          Check
        </button>
        {running && (
          <button type="button" onClick={giveUp} aria-label="Give up: stop checking this number" className={BUTTON_CLASS}>
            Give up
          </button>
        )}
      </form>

      <p id="prime-check-feedback" role="status" className="mt-3 min-h-6 text-sm text-(--heat-text)" data-testid="prime-check-status">
        {inputError ?? statusText(state, checkingMs)}
      </p>

      {shown && <Answer answer={shown.answer} elapsedMs={shown.elapsedMs} />}
      {canProve && (
        <div className="mt-3">
          <button type="button" onClick={prove} className={BUTTON_CLASS}>
            Prove it
          </button>
          <ProofEstimate digits={shown.answer.value.toString().length} />
        </div>
      )}
    </section>
  );
}
