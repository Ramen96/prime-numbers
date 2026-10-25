import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ELLIPSIS, fitNumber, textWidth, type GlyphWidths } from "./shortenNumber.ts";

const numberFormatter = new Intl.NumberFormat("en-US");
const format = (value: bigint) => numberFormatter.format(value);

// Widths are multiples of 1/8 px, so every sum is exact in floating point and
// "exactly as wide as the space" really is exact.
const MONOSPACE: GlyphWidths = { digit: 10, comma: 10, ellipsis: 10 };
const NARROW_COMMA: GlyphWidths = { digit: 7.625, comma: 2.5, ellipsis: 7.25 };

/** 2^64 − 59, the largest prime below 2^64: 7 groups. */
const LARGEST_PRIME_BELOW_2_TO_THE_64 = format(18_446_744_073_709_551_557n);

// ── an independent reference ─────────────────────────────────────────────

/** Width by counting characters, rather than adding them up one at a time. */
function referenceWidth(text: string, widths: GlyphWidths): number {
  const commas = text.split(",").length - 1;
  const ellipses = text.split(ELLIPSIS).length - 1;
  const digits = text.length - commas - ellipses;
  return digits * widths.digit + commas * widths.comma + ellipses * widths.ellipsis;
}

/**
 * What fitNumber should return, found by brute force: every group after the
 * first is 3 digits, so kept groups are split as evenly as possible (the front
 * gets the extra one, since it's added to first), and the answer is the most
 * groups whose split fits, with first and last kept even if they don't.
 */
function referenceFit(formatted: string, availablePx: number, widths: GlyphWidths): string {
  const groups = formatted.split(",");
  if (referenceWidth(formatted, widths) <= availablePx || groups.length < 3) return formatted;
  const join = (front: number, back: number) =>
    [...groups.slice(0, front), ELLIPSIS, ...groups.slice(groups.length - back)].join(",");
  for (let kept = groups.length - 1; kept > 2; kept--) {
    const candidate = join(Math.ceil(kept / 2), Math.floor(kept / 2));
    if (referenceWidth(candidate, widths) <= availablePx) return candidate;
  }
  return join(1, 1);
}

/** The groups before and after the ellipsis. */
function keptGroups(shortened: string): { front: string[]; back: string[] } {
  const [frontText, backText] = shortened.split(ELLIPSIS);
  return {
    front: frontText.split(",").slice(0, -1), // drop the empty piece before "…"
    back: backText.split(",").slice(1), // and after it
  };
}

const digitCount = (text: string) => text.replace(/[^\d]/g, "").length;

// ── seeded randomness, so a failure can be reproduced ─────────────────────

let randomState = 0x5eed_1234;
function randomUint32(): number {
  // xorshift32
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  randomState >>>= 0;
  return randomState;
}
const randomBelow = (limit: number) => randomUint32() % limit;

function randomNumberWithDigits(digits: number): bigint {
  let text = String(1 + randomBelow(9));
  for (let index = 1; index < digits; index++) text += String(randomBelow(10));
  return BigInt(text);
}

/** Between 1/8 and 16 px, in steps of 1/8 (so sums stay exact). */
const randomGlyphWidth = () => (1 + randomBelow(128)) / 8;

// ── tests ────────────────────────────────────────────────────────────────

describe("textWidth", () => {
  it("adds the width of each digit, comma and ellipsis", () => {
    assert.equal(textWidth("", NARROW_COMMA), 0);
    assert.equal(textWidth("123", NARROW_COMMA), 3 * 7.625);
    assert.equal(textWidth("1,234", NARROW_COMMA), 4 * 7.625 + 2.5);
    assert.equal(textWidth(`18,${ELLIPSIS},557`, NARROW_COMMA), 5 * 7.625 + 2 * 2.5 + 7.25);
  });
});

describe("fitNumber", () => {
  it("leaves a number whole when it fits", () => {
    const width = textWidth(LARGEST_PRIME_BELOW_2_TO_THE_64, MONOSPACE);
    assert.deepEqual(fitNumber(LARGEST_PRIME_BELOW_2_TO_THE_64, width + 100, MONOSPACE), {
      text: LARGEST_PRIME_BELOW_2_TO_THE_64,
      shortened: false,
    });
  });

  it("leaves a number whole when it's exactly as wide as the space", () => {
    const width = textWidth(LARGEST_PRIME_BELOW_2_TO_THE_64, NARROW_COMMA);
    assert.deepEqual(fitNumber(LARGEST_PRIME_BELOW_2_TO_THE_64, width, NARROW_COMMA), {
      text: LARGEST_PRIME_BELOW_2_TO_THE_64,
      shortened: false,
    });
    assert.equal(fitNumber(LARGEST_PRIME_BELOW_2_TO_THE_64, width - 0.125, NARROW_COMMA).shortened, true);
  });

  it("never shortens a number with fewer than 3 groups, since there's nothing to leave out", () => {
    for (const formatted of ["7", "65,537", "999,983"]) {
      assert.deepEqual(fitNumber(formatted, 1, MONOSPACE), { text: formatted, shortened: false });
    }
  });

  it("leaves groups out of the middle, taking them from the front first", () => {
    // 26 characters at 10px; each kept group adds 40px, and "18,…,557" is 80px.
    const fitsWithKept = (groups: number) => 80 + (groups - 2) * 40;
    assert.equal(fitNumber(LARGEST_PRIME_BELOW_2_TO_THE_64, fitsWithKept(2), MONOSPACE).text, `18,${ELLIPSIS},557`);
    assert.equal(fitNumber(LARGEST_PRIME_BELOW_2_TO_THE_64, fitsWithKept(3), MONOSPACE).text, `18,446,${ELLIPSIS},557`);
    assert.equal(fitNumber(LARGEST_PRIME_BELOW_2_TO_THE_64, fitsWithKept(4), MONOSPACE).text, `18,446,${ELLIPSIS},551,557`);
    assert.equal(
      fitNumber(LARGEST_PRIME_BELOW_2_TO_THE_64, fitsWithKept(6), MONOSPACE).text,
      `18,446,744,${ELLIPSIS},709,551,557`,
    );
  });

  it("always leaves at least one group out when it shortens", () => {
    // Too narrow for all 7 groups, but wide enough for all 7 plus an ellipsis
    // in place of a comma: still one group must go.
    const wholeWidth = textWidth(LARGEST_PRIME_BELOW_2_TO_THE_64, MONOSPACE);
    const fitted = fitNumber(LARGEST_PRIME_BELOW_2_TO_THE_64, wholeWidth - 1, MONOSPACE);
    assert.equal(fitted.shortened, true);
    const { front, back } = keptGroups(fitted.text);
    assert.equal(front.length + back.length, 6);
  });

  it("keeps the first and last groups even when they don't fit (the caller clips them)", () => {
    assert.deepEqual(fitNumber(LARGEST_PRIME_BELOW_2_TO_THE_64, 1, MONOSPACE), {
      text: `18,${ELLIPSIS},557`,
      shortened: true,
    });
  });

  it("matches a brute-force reference for random numbers, widths and fonts", () => {
    for (let trial = 0; trial < 3000; trial++) {
      const formatted = format(randomNumberWithDigits(1 + randomBelow(600)));
      const widths = { digit: randomGlyphWidth(), comma: randomGlyphWidth(), ellipsis: randomGlyphWidth() };
      const availablePx = randomBelow(Math.ceil(referenceWidth(formatted, widths) * 1.1) + 1);
      const fitted = fitNumber(formatted, availablePx, widths);
      const expected = referenceFit(formatted, availablePx, widths);
      const context = `${formatted.slice(0, 40)}… in ${availablePx}px with ${JSON.stringify(widths)}`;
      assert.equal(fitted.text, expected, context);
      assert.equal(fitted.shortened, expected !== formatted, context);
    }
  });

  it("returns the first and last groups of the number, balanced, fitting, and as full as possible", () => {
    for (let trial = 0; trial < 3000; trial++) {
      const formatted = format(randomNumberWithDigits(7 + randomBelow(300)));
      const widths = { digit: randomGlyphWidth(), comma: randomGlyphWidth(), ellipsis: randomGlyphWidth() };
      const availablePx = randomBelow(Math.ceil(referenceWidth(formatted, widths)));
      const fitted = fitNumber(formatted, availablePx, widths);
      const context = `${formatted.slice(0, 40)}… in ${availablePx}px`;
      if (!fitted.shortened) continue;

      const groups = formatted.split(",");
      const { front, back } = keptGroups(fitted.text);
      assert.deepEqual(front, groups.slice(0, front.length), context);
      assert.deepEqual(back, groups.slice(groups.length - back.length), context);
      assert.ok(front.length >= 1 && back.length >= 1, context);
      assert.ok(front.length + back.length < groups.length, `${context}: a group is left out`);
      assert.ok(front.length - back.length === 0 || front.length - back.length === 1, `${context}: balanced`);

      const join = (frontCount: number, backCount: number) =>
        [...groups.slice(0, frontCount), ELLIPSIS, ...groups.slice(groups.length - backCount)].join(",");
      const keptTwo = front.length === 1 && back.length === 1;
      if (!keptTwo) assert.ok(referenceWidth(fitted.text, widths) <= availablePx, `${context}: fits`);
      if (front.length + back.length + 1 < groups.length) {
        assert.ok(referenceWidth(join(front.length + 1, back.length), widths) > availablePx, `${context}: front is full`);
        assert.ok(referenceWidth(join(front.length, back.length + 1), widths) > availablePx, `${context}: back is full`);
      }
    }
  });

  it("never shows fewer digits in more space", () => {
    for (let trial = 0; trial < 100; trial++) {
      const formatted = format(randomNumberWithDigits(4 + randomBelow(200)));
      const widths = { digit: randomGlyphWidth(), comma: randomGlyphWidth(), ellipsis: randomGlyphWidth() };
      const wholeWidth = referenceWidth(formatted, widths);
      let previousDigits = 0;
      for (let availablePx = 0; availablePx <= wholeWidth + 8; availablePx += 4) {
        const digits = digitCount(fitNumber(formatted, availablePx, widths).text);
        assert.ok(digits >= previousDigits, `${formatted.slice(0, 40)}…: ${previousDigits} digits, then ${digits} at ${availablePx}px`);
        previousDigits = digits;
      }
    }
  });

  it("shortens a million-digit number, with no limit in the code (Requirement B)", () => {
    const value = 10n ** 999_999n + 7n;
    const formatted = format(value);
    const fitted = fitNumber(formatted, 300, MONOSPACE);
    assert.equal(fitted.shortened, true);
    // k kept groups take 40k − 10 px here, so 300px keeps 7: 4 in front, 3 behind.
    assert.equal(fitted.text, `1,000,000,000,${ELLIPSIS},000,000,007`);
  });
});
