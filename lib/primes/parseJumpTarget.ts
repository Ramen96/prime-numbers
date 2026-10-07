import { SIEVE_LIMIT } from "./protocol.ts";

export type JumpTargetResult =
  | { valid: true; target: bigint }
  | { valid: false; message: string };

/** Characters people use to group digits: "1,000,000", "1_000_000", "1 000 000". */
const DIGIT_SEPARATORS = /[\s,_]/g;
const WHOLE_NUMBER = /^\d+$/;
const NEGATIVE_NUMBER = /^-\d+(\.\d+)?$/;
const DECIMAL_NUMBER = /^\d*\.\d+$|^\d+\.\d*$/;

/**
 * Turns what the user typed into a number to jump to, or a friendly message
 * explaining why we can't.
 */
export function parseJumpTarget(userInput: string): JumpTargetResult {
  const digitsOnly = userInput.replace(DIGIT_SEPARATORS, "");

  if (digitsOnly === "") {
    return { valid: false, message: "Type a number to jump to." };
  }
  if (NEGATIVE_NUMBER.test(digitsOnly)) {
    return { valid: false, message: "Primes start at 2. Nothing down there." };
  }
  if (DECIMAL_NUMBER.test(digitsOnly)) {
    return { valid: false, message: "Whole numbers only. Primes don't do fractions." };
  }
  if (!WHOLE_NUMBER.test(digitsOnly)) {
    return { valid: false, message: "That doesn't look like a number." };
  }

  const target = BigInt(digitsOnly);
  if (target >= SIEVE_LIMIT) {
    return {
      valid: false,
      message:
        "The sieve stops at 2⁵³ − 1 (9,007,199,254,740,991) for now. Try a smaller number.",
    };
  }

  return { valid: true, target };
}
