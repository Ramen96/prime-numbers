import type { ReactNode } from "react";
import styles from "./ScrollableTable.module.scss";

interface Props {
  /** Names the scrolling region for screen readers, e.g. "Counting primes up to 10¹²". */
  label: string;
  /** The <table> itself. */
  children: ReactNode;
}

/**
 * A table that scrolls sideways inside its own box when it's wider than the
 * page, like the code blocks and wide formulas, instead of widening the page.
 * Focusable, as Shiki makes its code blocks, so the keyboard can scroll it too.
 */
export function ScrollableTable({ label, children }: Props) {
  return (
    <div className={styles.scrollableTable} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
