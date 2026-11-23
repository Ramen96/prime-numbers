"use client";

import { useState, type SubmitEvent } from "react";
import { formatWholeNumber } from "@/lib/formatNumber";
import { formatDuration } from "@/lib/formatRate";
import { useRandomPrime } from "@/lib/primes/useRandomPrime";
import { describeProving } from "@/lib/provingStatus";
import { parseDigits, RANDOM_PRIME_DEFAULT_DIGITS } from "@/lib/randomPrime";
import { CertificateSteps } from "./CertificateSteps";
import { WrappableNumber } from "./WrappableNumber";

/**
 * The random-prime page's working part: how many digits, Find, Give up while it
 * works, and the prime once it's proven and its certificate checked, with the
 * certificate itself (CertificateSteps).
 */
export function RandomPrime() {
  const { state, find, giveUp } = useRandomPrime();
  const [typedDigits, setTypedDigits] = useState(String(RANDOM_PRIME_DEFAULT_DIGITS));
  const [inputError, setInputError] = useState<string | null>(null);
  const finding = state.kind === "finding";

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const parsed = parseDigits(typedDigits);
    if (!parsed.valid) {
      setInputError(parsed.message);
      return;
    }
    setInputError(null);
    find(parsed.digits);
  };

  return (
    <section className="my-6" data-testid="random-prime">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-muted">Digits</span>
          <input
            type="text"
            inputMode="numeric"
            value={typedDigits}
            onChange={(event) => setTypedDigits(event.target.value)}
            disabled={finding}
            aria-invalid={inputError !== null}
            aria-describedby="random-prime-feedback"
            className="h-11 w-28 rounded-md border border-rule bg-background px-3 font-mono focus-visible:outline-2 focus-visible:outline-(--heat-text)"
          />
        </label>
        <button
          type="submit"
          disabled={finding}
          className="h-11 rounded-md border border-rule px-4 text-sm font-medium hover:border-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text) disabled:text-muted"
        >
          Find a random prime
        </button>
        {finding && (
          <button
            type="button"
            onClick={giveUp}
            aria-label="Give up: stop finding this prime"
            className="h-11 rounded-md border border-rule px-4 text-sm font-medium hover:border-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text)"
          >
            Give up
          </button>
        )}
      </form>

      <p id="random-prime-feedback" role="status" className="mt-3 min-h-6 text-sm text-(--heat-text)" data-testid="random-prime-status">
        {inputError ??
          (state.kind === "finding"
            ? state.proving
              ? describeProving(state.proving)
              : `finding a prime with ${formatWholeNumber(BigInt(state.digits))} digits…`
            : state.kind === "gave-up"
              ? "Gave up on that one."
              : state.kind === "memory-limit"
                ? "This device ran out of memory before the prime could be proven."
                : state.kind === "error"
                  ? `Stopped. ${state.message}`
                  : "")}
      </p>

      {state.kind === "found" && (
        <div className="mt-2" data-testid="random-prime-result">
          <p className="font-mono text-lg leading-snug break-words" data-testid="random-prime-value">
            <WrappableNumber value={state.prime} />
          </p>
          <p className="mt-2 text-sm text-muted">
            {formatWholeNumber(BigInt(state.digits))} digits, found and proven in{" "}
            {state.elapsedMs < 100 ? "under 0.1 s" : formatDuration(state.elapsedMs / 1000)}.
          </p>
          <CertificateSteps prime={state.prime} steps={state.certificate} checkerOnThisPage />
        </div>
      )}
    </section>
  );
}
