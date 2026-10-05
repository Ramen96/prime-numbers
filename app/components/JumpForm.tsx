"use client";

import { useState, type SubmitEvent } from "react";
import { parseJumpTarget } from "@/lib/primes/parseJumpTarget";
import type { JumpResult } from "@/lib/primes/usePrimeBuffer";
import styles from "./JumpForm.module.scss";

interface Props {
  onJump: (target: number) => void;
  lastJump: JumpResult | null;
}

const numberFormatter = new Intl.NumberFormat("en-US");

export function JumpForm({ onJump, lastJump }: Props) {
  const [userInput, setUserInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const result = parseJumpTarget(userInput);
    if (!result.valid) {
      setErrorMessage(result.message);
      return;
    }
    setErrorMessage(null);
    onJump(result.target);
  };

  return (
    <form onSubmit={handleSubmit} className="border-b border-rule px-5 py-3 desktop:px-0">
      <div className="flex gap-2">
        <label htmlFor="jump-target" className="sr-only">
          Jump to number
        </label>
        <input
          id="jump-target"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Jump to… e.g. 15,000,000"
          value={userInput}
          onChange={(event) => setUserInput(event.target.value)}
          aria-invalid={errorMessage !== null}
          aria-describedby="jump-feedback"
          className="min-w-0 flex-1 h-11 rounded-md border bg-transparent px-3 tabular-nums outline-none placeholder:font-sans placeholder:text-muted aria-invalid:border-(--hot)"
        />
        <button
          type="submit"
          className="h-11 rounded-md bg-foreground px-5 font-medium text-background hover:opacity-85 active:opacity-70"
        >
          Jump
        </button>
      </div>

      <p id="jump-feedback" aria-live="polite" className="mt-1.5 min-h-5 text-sm">
        {errorMessage ? (
          <span className="text-(--hot)">{errorMessage}</span>
        ) : lastJump ? (
          // Keyed by generation so the fade-out restarts on every jump.
          <span key={lastJump.generation} className={`${styles.fadingNotice} text-muted`}>
            Jumped to{" "}
            <span className="font-mono text-foreground">
              {numberFormatter.format(lastJump.firstPrimeFound)}
            </span>
            {lastJump.firstPrimeFound !== lastJump.requestedNumber &&
              ` (first prime ≥ ${numberFormatter.format(lastJump.requestedNumber)})`}
          </span>
        ) : null}
      </p>
    </form>
  );
}
