export type JumpTargetResult =
  | { valid: true; target: number }
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

  // Compare as BigInt: past 2^53 a JS number rounds, so a too-big input
  // could round down and slip past a plain `>=` check.
  if (BigInt(digitsOnly) >= BigInt(Number.MAX_SAFE_INTEGER)) {
    return {
      valid: false,
      message:
        "Past 2⁵³ − 1, JavaScript can't count exactly. We'd rather show nothing than wrong primes.",
    };
  }

  return { valid: true, target: Number(digitsOnly) };
}
