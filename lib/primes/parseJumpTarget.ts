import { formatWholeNumber } from "../formatNumber.ts";
import { readWholeNumber, type WholeNumberProblem } from "../wholeNumberExpression.ts";

export type JumpTargetResult =
  | {
      valid: true;
      target: bigint;
      /** What was typed, as read (“2^127-1”), when it wasn't a plain number: lib/wholeNumberExpression.ts. */
      written: string | null;
    }
  | { valid: false; message: string };

export const TOO_MANY_DIGITS_MESSAGE = "That’s more digits than this browser can hold as one number.";

/** What the number is for, where the messages differ: the jump box or the prime checker. */
export type NumberPurpose = "jump" | "check";

/** Why a number can't be read, in the words of the box that read it. */
export function describeNumberProblem(found: WholeNumberProblem, purpose: NumberPurpose): string {
  switch (found.kind) {
    case "empty":
      return purpose === "jump" ? "Type a number to jump to." : "Type a number to check.";
    case "negative":
      return "Primes start at 2. Nothing down there.";
    case "fraction":
      return "Whole numbers only. Primes don’t do fractions.";
    case "not-a-number":
      return "That doesn’t look like a number. Try 1,000,003, 1e100 or 2^127 − 1.";
    case "comma-in-expression":
      return "Commas only go in plain numbers, like 1,000,003.";
    case "zero-to-the-zero":
      return `0⁰ has no agreed value, so there’s nothing to ${purpose === "jump" ? "jump to" : "check"}.`;
    case "too-many-digits":
      if (found.digits === undefined) return TOO_MANY_DIGITS_MESSAGE;
      return `That has ${found.about ? "about " : ""}${formatWholeNumber(found.digits)} digits: more than this browser can hold as one number.`;
  }
}

/**
 * Turns what the user typed into a number, or a friendly message explaining why
 * we can’t. Any size the code is concerned with: a jump far past what this device
 * can reach just runs slowly (and Stop exists for that), never a wrong answer.
 * Only the browser limits it (lib/wholeNumberExpression.ts).
 */
export function parseWholeNumber(userInput: string, purpose: NumberPurpose): JumpTargetResult {
  const reading = readWholeNumber(userInput);
  if (!reading.valid) return { valid: false, message: describeNumberProblem(reading.problem, purpose) };
  return { valid: true, target: reading.value, written: reading.written };
}

/** A number to jump to, from the jump box or ?jump=. */
export function parseJumpTarget(userInput: string): JumpTargetResult {
  return parseWholeNumber(userInput, "jump");
}
