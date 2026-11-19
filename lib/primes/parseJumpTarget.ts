export type JumpTargetResult =
  | { valid: true; target: bigint }
  | { valid: false; message: string };

/** Characters people use to group digits: "1,000,000", "1_000_000", "1 000 000". */
const DIGIT_SEPARATORS = /[\s,_]/g;
const WHOLE_NUMBER = /^\d+$/;
const NEGATIVE_NUMBER = /^-\d+(\.\d+)?$/;
const DECIMAL_NUMBER = /^\d*\.\d+$|^\d+\.\d*$/;
export const TOO_MANY_DIGITS_MESSAGE = "That’s more digits than this browser can hold as one number.";

/**
 * Turns what the user typed into a number to jump to, or a friendly message
 * explaining why we can’t.
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
    return { valid: false, message: "Whole numbers only. Primes don’t do fractions." };
  }
  if (!WHOLE_NUMBER.test(digitsOnly)) {
    return { valid: false, message: "That doesn’t look like a number." };
  }

  // Any size the code is concerned with: a jump far past what this device can reach
  // just runs slowly (and Stop exists for that), never a wrong answer. Only the
  // browser limits it. BigInt() throws past the longest BigInt the browser can hold
  // (2^30 bits, about 323 million digits, in Chromium, which throws a SyntaxError,
  // not a RangeError). The text is already known to be digits, so any throw here
  // means that limit.
  try {
    return { valid: true, target: BigInt(digitsOnly) };
  } catch {
    return { valid: false, message: TOO_MANY_DIGITS_MESSAGE };
  }
}
