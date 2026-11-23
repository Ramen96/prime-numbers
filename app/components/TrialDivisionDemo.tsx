"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { listedNumber } from "@/lib/listedNumbers";
import {
  TRIAL_DIVISION_DEMO_MAX,
  TRIAL_DIVISION_DEMO_START,
  TRIAL_DIVISION_INVALID_MESSAGE,
  TRIAL_DIVISION_TOO_BIG_MESSAGE,
  describeStep,
  parseTrialDivisionInput,
  trialDivision,
  trialDivisionConclusion,
  type TrialDivision,
} from "@/lib/trialDivisionDemo";

const BUTTON_CLASS =
  "h-11 rounded-md border border-rule px-4 text-sm font-medium hover:border-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text)";
// inline, to override the article's list style (.prose ol), which outranks utilities
const LIST_STYLE = { listStyle: "none", paddingLeft: 0 } as const;

type Shown = { kind: "division"; division: TrialDivision } | { kind: "too-big"; digits: string } | { kind: "invalid" };

/** A listed number has a page of its own; any other goes to the checker's ?n=. */
function checkerHref(digits: string): string {
  return listedNumber(BigInt(digits)) ? `/is-prime/${digits}` : `/is-prime?n=${digits}`;
}

/**
 * Type a number up to 10,000 and watch it divided by each prime up to its square
 * root, until one divides it evenly. Starts with 97, so the page is built with an
 * answer. Bigger numbers get a link to the prime checker.
 */
export function TrialDivisionDemo() {
  const inputId = useId();
  const [typed, setTyped] = useState(String(TRIAL_DIVISION_DEMO_START));
  const [shown, setShown] = useState<Shown>({ kind: "division", division: trialDivision(TRIAL_DIVISION_DEMO_START) });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = parseTrialDivisionInput(typed);
    if (input.kind === "number") setShown({ kind: "division", division: trialDivision(input.value) });
    else setShown(input);
  }

  return (
    <figure className="my-6 rounded-md border border-rule p-4" data-testid="trial-division-demo">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <label htmlFor={inputId} className="flex min-w-0 grow flex-col text-sm">
          <span className="mb-1 text-muted">A number from 2 to {TRIAL_DIVISION_DEMO_MAX.toLocaleString("en-US")}</span>
          <input
            id={inputId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            aria-invalid={shown.kind === "invalid"}
            className="h-11 w-full min-w-0 rounded-md border border-rule bg-background px-3 font-mono focus-visible:outline-2 focus-visible:outline-(--heat-text)"
          />
        </label>
        <button type="submit" className={BUTTON_CLASS}>
          Divide
        </button>
      </form>
      {shown.kind === "division" && <DivisionSteps division={shown.division} />}
      {/* only the answer is announced, not every division */}
      <p role="status" className="mt-2! mb-0! [overflow-wrap:anywhere]" data-testid="trial-division-result">
        {shown.kind === "invalid" && <span className="text-(--heat-text)">{TRIAL_DIVISION_INVALID_MESSAGE}</span>}
        {shown.kind === "too-big" && (
          <>
            {TRIAL_DIVISION_TOO_BIG_MESSAGE} <Link href={checkerHref(shown.digits)}>Check it with the prime checker →</Link>
          </>
        )}
        {shown.kind === "division" && <Conclusion division={shown.division} />}
      </p>
    </figure>
  );
}

function DivisionSteps({ division }: { division: TrialDivision }) {
  if (division.steps.length === 0) return null;
  return (
    <ol style={LIST_STYLE} className="mt-3! mb-0! font-mono text-sm leading-relaxed" data-testid="trial-division-steps">
      {division.steps.map((step) => (
        <li
          key={step.divisor}
          className={`m-0! ${step.remainder === 0 ? "font-bold text-(--heat-text)" : ""}`}
          data-divides={step.remainder === 0 || undefined}
        >
          {describeStep(division.value, step)}
        </li>
      ))}
    </ol>
  );
}

function Conclusion({ division }: { division: TrialDivision }) {
  const { before, number, after } = trialDivisionConclusion(division);
  return (
    <span data-testid="trial-division-conclusion">
      {before}
      <Link href={checkerHref(String(division.value))}>{number}</Link>
      {after}
    </span>
  );
}
