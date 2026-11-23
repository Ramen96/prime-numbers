// Shortening a formatted number to fit a width, in the middle, at comma
// group boundaries: 18,446,744,073,709,551,557 can become
// 18,446,744,…,551,557. Primes can have any number of digits (CLAUDE.md,
// Requirement B), and a list row has a fixed height, so a long prime is
// shortened rather than wrapped; the full number is a tap away.
//
// Widths come from the font, measured once (see GlyphRuler.tsx), not by
// measuring each number: digits are tabular, so every digit has one width.

/** The widths in px of the characters a formatted number can contain. */
export interface GlyphWidths {
  digit: number;
  comma: number;
  ellipsis: number;
}

export const ELLIPSIS = "…";

/** Width in px of `text`, made only of digits, commas and the ellipsis. */
export function textWidth(text: string, widths: GlyphWidths): number {
  let width = 0;
  for (const character of text) {
    width += character === "," ? widths.comma : character === ELLIPSIS ? widths.ellipsis : widths.digit;
  }
  return width;
}

export interface FittedNumber {
  /** What to show: the whole number, or its first and last groups around "…". */
  text: string;
  shortened: boolean;
}

/**
 * The number formatted with commas (`formatted`), whole if it fits in
 * `availablePx`, otherwise with groups left out of the middle: as many
 * groups as fit, taken alternately from the front and the back, and always
 * at least the first and the last. If even those two don't fit, they're
 * returned anyway (the caller clips them; it doesn't happen down to 360px).
 */
export function fitNumber(formatted: string, availablePx: number, widths: GlyphWidths): FittedNumber {
  if (textWidth(formatted, widths) <= availablePx) return { text: formatted, shortened: false };
  const groups = formatted.split(",");
  if (groups.length < 3) return { text: formatted, shortened: false }; // nothing to leave out

  const join = (front: number, back: number) =>
    [...groups.slice(0, front), ELLIPSIS, ...groups.slice(groups.length - back)].join(",");
  let front = 1;
  let back = 1;
  // keep at least one group out, or it isn't shortened
  while (front + back < groups.length - 1) {
    const addToFront = front <= back;
    const [nextFront, nextBack] = addToFront ? [front + 1, back] : [front, back + 1];
    if (textWidth(join(nextFront, nextBack), widths) <= availablePx) {
      [front, back] = [nextFront, nextBack];
      continue;
    }
    // that side's next group is too wide; the other side's may still fit
    const [otherFront, otherBack] = addToFront ? [front, back + 1] : [front + 1, back];
    if (textWidth(join(otherFront, otherBack), widths) > availablePx) break;
    [front, back] = [otherFront, otherBack];
  }
  return { text: join(front, back), shortened: true };
}

/** At most this share of a row's width goes to a position label that sits beside a prime too long to fit with it. */
export const LABEL_SHARE_BESIDE_PRIME = 0.4;

export interface RowSpaceForFit {
  /** The width the prime and its label share. */
  columnPx: number;
  /** From 640px up the label sits beside the prime (they split the width); below, under it (each gets all of it). */
  labelBesidePrime: boolean;
  primeGlyphs: GlyphWidths;
  labelGlyphs: GlyphWidths;
  /** The width of the label before its digits: "#", or "≈ #" after a jump. */
  labelPrefixPx: number;
}

/**
 * A list row's prime and its position label (the ordinal's digits, without
 * "#"), each shortened in the middle like fitNumber if it must be. Under the
 * prime, each gets the whole width. Beside it, both stay whole if they fit
 * (with a digit's width between); otherwise the label gets what the whole prime
 * leaves, but always at least LABEL_SHARE_BESIDE_PRIME of the row if it needs
 * it, and the prime the rest. So far out, where both are long, neither can
 * crowd the other out.
 */
export function fitPrimeAndLabel(
  formattedPrime: string,
  formattedOrdinal: string,
  space: RowSpaceForFit,
): { prime: FittedNumber; label: FittedNumber } {
  const { columnPx, labelBesidePrime, primeGlyphs, labelGlyphs, labelPrefixPx } = space;
  if (!labelBesidePrime) {
    return {
      prime: fitNumber(formattedPrime, columnPx, primeGlyphs),
      label: fitNumber(formattedOrdinal, columnPx - labelPrefixPx, labelGlyphs),
    };
  }
  const gapPx = primeGlyphs.digit;
  const wholeLabelPx = labelPrefixPx + textWidth(formattedOrdinal, labelGlyphs);
  const wholePrimePx = textWidth(formattedPrime, primeGlyphs);
  const labelBudgetPx = Math.min(wholeLabelPx, Math.max(columnPx - gapPx - wholePrimePx, columnPx * LABEL_SHARE_BESIDE_PRIME));
  const label = fitNumber(formattedOrdinal, labelBudgetPx - labelPrefixPx, labelGlyphs);
  const shownLabelPx = labelPrefixPx + textWidth(label.text, labelGlyphs);
  return { prime: fitNumber(formattedPrime, columnPx - shownLabelPx - gapPx, primeGlyphs), label };
}
