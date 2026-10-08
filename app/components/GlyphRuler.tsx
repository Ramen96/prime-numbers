import type { GlyphWidths } from "@/lib/shortenNumber";
import styles from "./GlyphRuler.module.scss";

/** Characters per run (GlyphRuler.module.scss): averaging absorbs sub-pixel rounding. */
const RUN_LENGTH = 10;

/**
 * Invisible runs of digits, commas and ellipses in the given font classes,
 * so their widths can be read with readGlyphWidths. Hidden from everything:
 * no layout space (absolute), no paint, no accessibility tree, and no text
 * (the runs are CSS generated content).
 */
export function GlyphRuler({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`pointer-events-none invisible absolute top-0 left-0 whitespace-nowrap ${className}`}>
      <span data-glyph="digit" className={styles.digit} />
      <span data-glyph="comma" className={styles.comma} />
      <span data-glyph="ellipsis" className={styles.ellipsis} />
    </span>
  );
}

/** The widths measured by a GlyphRuler (or null if it isn't laid out yet). */
export function readGlyphWidths(ruler: Element | null): GlyphWidths | null {
  if (!ruler) return null;
  const widthOf = (glyph: string) =>
    (ruler.querySelector(`[data-glyph="${glyph}"]`)?.getBoundingClientRect().width ?? 0) / RUN_LENGTH;
  const widths = { digit: widthOf("digit"), comma: widthOf("comma"), ellipsis: widthOf("ellipsis") };
  return widths.digit > 0 ? widths : null;
}
