"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type SubmitEvent } from "react";
import { shortNumber } from "@/lib/certificateCheck";
import { formatWholeNumber } from "@/lib/formatNumber";
import { formatDuration } from "@/lib/formatRate";
import { listedNumber } from "@/lib/listedNumbers";
import {
  describeProofTime,
  estimatedProofSeconds,
  HUGE_PROOF_SECONDS,
  parseNumberToCheck,
  type PrimeCheckAnswer as Answer,
} from "@/lib/primeCheck";
import { usePrimeCheck, type PrimeCheckState } from "@/lib/primes/usePrimeCheck";
import { describeProving } from "@/lib/provingStatus";
import { MAX_DIGITS_IN_URL, PrimeCheckAnswer } from "./PrimeCheckAnswer";

/** The checking row shows the time from this long on. */
const SHOW_CHECKING_TIME_AFTER_MS = 1000;

const BUTTON_CLASS =
  "h-11 rounded-md border border-rule px-4 text-sm font-medium hover:border-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text) disabled:text-muted";

/** A listed number's own page: built ahead of time with its answer (app/is-prime/[n]). */
const listedPage = (value: bigint) => `/is-prime/${value}`;

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
function shownAnswer(state: PrimeCheckState): { answer: Answer; elapsedMs: number | null } | null {
  if (state.kind === "answered") return { answer: state.answer, elapsedMs: state.elapsedMs };
  if (state.kind === "proving") return { answer: state.answer, elapsedMs: null };
  if (state.kind === "gave-up" && state.answer) return { answer: state.answer, elapsedMs: null };
  return null;
}

/** What a proof of this probable prime would take, said before it starts. */
function ProofEstimate({ digits }: { digits: number }) {
  const seconds = estimatedProofSeconds(digits);
  return (
    <p className="mt-2 text-sm text-muted" data-testid="prime-check-estimate">
      A proof of a {formatWholeNumber(BigInt(digits))}-digit number takes {describeProofTime(seconds)} on a laptop; a
      phone is slower.
      {seconds >= HUGE_PROOF_SECONDS &&
        " That’s a big number. The page will try, and “Give up” is right there. Only your device decides how far it can go."}
    </p>
  );
}

/**
 * The prime checker (/is-prime): a number in, an answer out with its evidence,
 * and for a probable prime past 3.3 × 10^24, “Prove it”. The number goes in the
 * address bar (`?n=`), so an answer can be shared and the back button works. A
 * listed number (lib/listedNumbers.ts) opens its own page instead. On such a
 * page (`onListedPage`), every number is checked by going to its page or to
 * /is-prime, never in place, so the page's own answer isn't left under another.
 */
export function PrimeChecker({ onListedPage = false }: { onListedPage?: boolean }) {
  const router = useRouter();
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
      if (listedNumber(fromAddress.value)) {
        router.replace(listedPage(fromAddress.value)); // its own page has the answer already
        return;
      }
      setTypedNumber(fromAddress.typed);
      setInputError(null);
      check(fromAddress.value);
    };
    checkAddress();
    window.addEventListener("popstate", checkAddress);
    return () => window.removeEventListener("popstate", checkAddress);
  }, [check, router]);

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const parsed = parseNumberToCheck(typedNumber);
    if (!parsed.valid) {
      setInputError(parsed.message);
      return;
    }
    setInputError(null);
    const digits = parsed.target.toString();
    if (listedNumber(parsed.target)) {
      router.push(listedPage(parsed.target));
      return;
    }
    const fitsAddress = digits.length <= MAX_DIGITS_IN_URL;
    if (onListedPage && fitsAddress) {
      router.push(`/is-prime?n=${digits}`);
      return;
    }
    // too long for an address: checked here (on a listed page, its address stays)
    const address = fitsAddress ? `/is-prime?n=${digits}` : "/is-prime";
    if (!onListedPage && window.location.pathname + window.location.search !== address) window.history.pushState(null, "", address);
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

      {shown && <PrimeCheckAnswer answer={shown.answer} elapsedMs={shown.elapsedMs} />}
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
