"use client";

import { useId, useState } from "react";
import {
  LUCAS_LEHMER_DEMO_EXPONENTS,
  LUCAS_LEHMER_DEMO_START,
  describeTerm,
  lucasLehmer,
  lucasLehmerConclusion,
} from "@/lib/lucasLehmerDemo";

// inline, to override the article's list style (.prose ol), which outranks utilities
const LIST_STYLE = { listStyle: "none", paddingLeft: 0 } as const;

/**
 * Pick an odd prime p up to 31 and watch the Lucas–Lehmer sequence for 2ᵖ − 1,
 * updated as soon as the choice changes. Starts on 7, so the page is built with
 * an answer. Only the conclusion is announced, not every term.
 */
export function LucasLehmerDemo() {
  const selectId = useId();
  const [exponent, setExponent] = useState<number>(LUCAS_LEHMER_DEMO_START);
  const run = lucasLehmer(exponent);
  return (
    <figure className="my-6 rounded-md border border-rule p-4" data-testid="lucas-lehmer-demo">
      <label htmlFor={selectId} className="flex flex-col text-sm">
        <span className="mb-1 text-muted">The exponent p</span>
        <select
          id={selectId}
          value={exponent}
          onChange={(event) => setExponent(Number(event.target.value))}
          className="h-11 w-32 rounded-md border border-rule bg-background px-3 font-mono focus-visible:outline-2 focus-visible:outline-(--heat-text)"
        >
          {LUCAS_LEHMER_DEMO_EXPONENTS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <ol
        style={LIST_STYLE}
        className="mt-3! mb-0! flex flex-col gap-1 font-mono text-sm leading-relaxed [overflow-wrap:anywhere]"
        data-testid="lucas-lehmer-terms"
      >
        {run.terms.map((_, step) => {
          const last = step === run.terms.length - 1;
          return (
            <li key={step} className={`m-0! ${last ? `font-bold ${run.prime ? "text-(--heat-text)" : ""}` : ""}`}>
              {describeTerm(run, step)}
            </li>
          );
        })}
      </ol>
      <p role="status" className="mt-2! mb-0!" data-testid="lucas-lehmer-result">
        {lucasLehmerConclusion(run)}
      </p>
    </figure>
  );
}
