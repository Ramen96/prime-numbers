// Reads a whole number written out, in scientific notation or as powers, for the
// jump box and the prime checker: “1,000,003”, “1e100”, “1.5e3”, “2^127 − 1”,
// “10¹⁰⁰ + 7”. Everything is BigInt, never floating point, so 1e23 is exactly
// 10^23 (a double would make it 99,999,999,999,999,991,611,392).
//
//   expression = [sign] term (("+" | "-") term)*
//   term       = digits                     a plain number (no point)
//              | mantissa ("e" | "E") [sign] digits    1e100, 1.5e3, .5e1, 1000e-3
//              | digits "^" [sign] digits   2^127 (also written 2**127 or 2¹²⁷)
//
// Spaces are ignored anywhere; “−” (the site's own minus sign) is a minus. Commas
// and underscores group digits in a plain number only: in an expression “1,5e3”
// could mean 1.5e3 or 15e3. No brackets, products or towers (2^2^3).

export type WholeNumberProblem =
  | { kind: "empty" }
  | { kind: "negative" }
  | { kind: "fraction" }
  | { kind: "not-a-number" }
  | { kind: "comma-in-expression" }
  | { kind: "zero-to-the-zero" }
  /** `digits` when it's known without building the number; `about` when it's estimated. */
  | { kind: "too-many-digits"; digits?: bigint; about?: boolean };

export type WholeNumberReading =
  | {
      valid: true;
      value: bigint;
      /** The expression as read (spaces gone, in ASCII: “2^127-1”), or null for a plain number. */
      written: string | null;
    }
  | { valid: false; problem: WholeNumberProblem };

/**
 * The most bits a BigInt can have in V8 (Chromium and Node): past it, BigInt()
 * and ** throw. A number surely longer than this is refused before anything is
 * built (10^1000000000 would otherwise take seconds, then fail). Other browsers
 * may stop sooner (Firefox's limit is unverified, CLAUDE.md step 9): their
 * RangeError is caught and refused the same way.
 */
export const LARGEST_BIGINT_BITS = 2n ** 30n;

const DIGIT_SEPARATORS = /[,_]/g;
const HAS_DIGIT_SEPARATOR = /[,_]/;
const WHOLE_NUMBER = /^\d+$/;
const NEGATIVE_NUMBER = /^-\d+(\.\d+)?$/;
const DECIMAL_NUMBER = /^\d*\.\d+$|^\d+\.\d*$/;
const SUPERSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const SUPERSCRIPT_RUN = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g;
/** A term, read from where the last one ended: a power, or a number with an optional exponent. */
const POWER_TERM = /(\d+)\^([+-]?\d+)/y;
const NUMBER_TERM = /(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?|\.(\d+)(?:[eE]([+-]?\d+))?/y;
/** log₂ 10 rounded down, as a fraction: a lower bound on the bits 10^k needs. */
const LOG2_OF_10_NUMERATOR = 33_219n;
const LOG2_OF_10_DENOMINATOR = 10_000n;

const problem = (found: WholeNumberProblem): WholeNumberReading => ({ valid: false, problem: found });

/** “2¹²⁷−1” → “2^127-1”, “2**127” → “2^127”, spaces gone. */
function normalize(userInput: string): string {
  return userInput
    .replace(/\s/g, "")
    .replace(/−/g, "-")
    .replace(/\*\*/g, "^")
    .replace(SUPERSCRIPT_RUN, (run) => "^" + [...run].map((digit) => SUPERSCRIPT_DIGITS.indexOf(digit)).join(""));
}

function bitLength(value: bigint): bigint {
  return BigInt(value.toString(2).length);
}

/** The digit count of `value` (positive), or a guess, from its decimal text. Only for messages. */
function log10Of(value: bigint): number {
  const text = value.toString();
  return text.length - 1 + Math.log10(Number(`${text.slice(0, 1)}.${text.slice(1, 16) || "0"}`));
}

type Term = { valid: true; value: bigint } | { valid: false; problem: WholeNumberProblem };

/** base^exponent, refusing it unbuilt if it surely has more bits than a BigInt can hold. */
function power(base: bigint, exponent: bigint): Term {
  if (exponent < 0n) {
    if (base === 1n) return { valid: true, value: 1n };
    return { valid: false, problem: { kind: base === 0n ? "not-a-number" : "fraction" } };
  }
  if (exponent === 0n) return base === 0n ? { valid: false, problem: { kind: "zero-to-the-zero" } } : { valid: true, value: 1n };
  if (base <= 1n) return { valid: true, value: base };
  // base^exponent has at least exponent × (bits(base) − 1) + 1 bits
  if (exponent * (bitLength(base) - 1n) + 1n > LARGEST_BIGINT_BITS) {
    const baseText = base.toString();
    if (/^10*$/.test(baseText)) return tooManyDigits(exponent * BigInt(baseText.length - 1) + 1n, false);
    const estimate = Number(exponent) * log10Of(base);
    return tooManyDigits(Number.isFinite(estimate) ? BigInt(Math.floor(estimate)) + 1n : undefined, true);
  }
  return built(() => base ** exponent);
}

function tooManyDigits(digits: bigint | undefined, about: boolean): Term {
  return { valid: false, problem: digits === undefined ? { kind: "too-many-digits" } : { kind: "too-many-digits", digits, about } };
}

/** Runs `build`, which can only fail past the browser's BigInt limit. */
function built(build: () => bigint): Term {
  try {
    return { valid: true, value: build() };
  } catch {
    return { valid: false, problem: { kind: "too-many-digits" } };
  }
}

/**
 * wholeDigits.fractionDigits × 10^exponent, if that's whole: the mantissa's
 * digits as one integer, shifted by the exponent less the fraction's length.
 * A negative shift must only drop zeros, so 1000e-3 is 1 and 1.25e1 isn't whole.
 */
function scientific(wholeDigits: string, fractionDigits: string, exponent: bigint): Term {
  const digits = (wholeDigits + fractionDigits).replace(/^0+/, "");
  if (digits === "") return { valid: true, value: 0n };
  const shift = exponent - BigInt(fractionDigits.length);
  if (shift < 0n) {
    const trailingZeros = BigInt(digits.length - digits.replace(/0+$/, "").length);
    if (trailingZeros < -shift) return { valid: false, problem: { kind: "fraction" } };
    return { valid: true, value: BigInt(digits.slice(0, digits.length + Number(shift))) };
  }
  // at least bits(digits) − 1 + shift × log₂ 10 bits
  const fewestBits = bitLength(BigInt(digits)) - 1n + (shift * LOG2_OF_10_NUMERATOR) / LOG2_OF_10_DENOMINATOR;
  if (fewestBits > LARGEST_BIGINT_BITS) return tooManyDigits(BigInt(digits.length) + shift, false);
  return built(() => BigInt(digits) * 10n ** shift);
}

/** Reads one term at `position`, returning it and where it ends, or null if none starts there. */
function readTerm(text: string, position: number): { term: Term; end: number } | null {
  POWER_TERM.lastIndex = position;
  const powerMatch = POWER_TERM.exec(text);
  if (powerMatch) return { term: power(BigInt(powerMatch[1]), BigInt(powerMatch[2])), end: POWER_TERM.lastIndex };

  NUMBER_TERM.lastIndex = position;
  const numberMatch = NUMBER_TERM.exec(text);
  if (!numberMatch) return null;
  const [, wholeDigits, fractionDigits, exponent, pointFirstDigits, pointFirstExponent] = numberMatch;
  const end = NUMBER_TERM.lastIndex;
  if (pointFirstDigits !== undefined) {
    // “.5e1”: a point needs an exponent to be whole, as “2.5” alone isn't
    if (pointFirstExponent === undefined) return { term: { valid: false, problem: { kind: "fraction" } }, end };
    return { term: scientific("", pointFirstDigits, BigInt(pointFirstExponent)), end };
  }
  if (exponent === undefined) {
    if (fractionDigits !== undefined) return { term: { valid: false, problem: { kind: "fraction" } }, end };
    return { term: built(() => BigInt(wholeDigits)), end };
  }
  return { term: scientific(wholeDigits, fractionDigits ?? "", BigInt(exponent)), end };
}

/** The plain-number path, exactly as the jump box read numbers before expressions. */
function readPlainNumber(text: string): WholeNumberReading {
  const digitsOnly = text.replace(DIGIT_SEPARATORS, "");
  if (digitsOnly === "") return problem({ kind: "empty" });
  if (NEGATIVE_NUMBER.test(digitsOnly)) return problem({ kind: "negative" });
  if (DECIMAL_NUMBER.test(digitsOnly)) return problem({ kind: "fraction" });
  if (!WHOLE_NUMBER.test(digitsOnly)) return problem({ kind: "not-a-number" });
  // Only the browser limits a typed number: BigInt() throws past the longest it can
  // hold (2^30 bits, about 323 million digits, in Chromium, as a SyntaxError, not a
  // RangeError). The text is digits, so any throw here means that limit.
  const term = built(() => BigInt(digitsOnly));
  return term.valid ? { valid: true, value: term.value, written: null } : problem(term.problem);
}

export function readWholeNumber(userInput: string): WholeNumberReading {
  const text = normalize(userInput);
  // no operator, exponent or power past a leading sign: a plain number, separators allowed
  if (!/[eE^+]/.test(text) && !text.slice(1).includes("-")) return readPlainNumber(text);
  if (HAS_DIGIT_SEPARATOR.test(text)) return problem({ kind: "comma-in-expression" });

  let position = 0;
  let sign = 1n;
  if (text[0] === "+" || text[0] === "-") {
    sign = text[0] === "-" ? -1n : 1n;
    position = 1;
  }
  let total: bigint | null = null;
  let firstProblem: WholeNumberProblem | null = null;
  for (;;) {
    const read = readTerm(text, position);
    if (!read) return problem({ kind: "not-a-number" });
    // a malformed expression says so even after a term that can't be built
    if (!read.term.valid) firstProblem ??= read.term.problem;
    else if (firstProblem === null) {
      // V8 sizes a sum's (and a product's) result before computing it, so near
      // its limit even 1 × x or 0 + x throws: the first term is taken as it is.
      const { value } = read.term;
      const sum = built(() => (total === null ? (sign < 0n ? -value : value) : sign < 0n ? total - value : total + value));
      if (sum.valid) total = sum.value;
      else firstProblem = sum.problem;
    }
    position = read.end;
    if (position === text.length) break;
    const operator = text[position];
    if (operator !== "+" && operator !== "-") return problem({ kind: "not-a-number" });
    sign = operator === "-" ? -1n : 1n;
    position += 1;
  }
  if (firstProblem || total === null) return problem(firstProblem ?? { kind: "not-a-number" });
  if (total < 0n) return problem({ kind: "negative" });
  return { valid: true, value: total, written: text };
}

/**
 * How to put the number in an address: the expression, if one was read and it's
 * shorter than the digits (so a link to 10^1000000 stays short), else the digits.
 * The digits are only written out when they're no longer than the expression.
 */
export function shortestWriting(value: bigint, written: string | null): string {
  if (written !== null && value >= 10n ** BigInt(written.length)) return written;
  return value.toString();
}
