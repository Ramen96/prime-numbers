import type { ReactNode } from "react";
import { DEFAULT_DEPTH, depthName, type DepthLevel } from "@/lib/howItWorksDepth";
import styles from "./DepthSection.module.scss";

interface Props {
  id: string;
  title: string;
  /** The basics: always shown. */
  children: ReactNode;
  /** The deeper levels, in order; a level with nothing new is left out, and so is everything after it. */
  deeper?: ReactNode;
  underTheHood?: ReactNode;
  turtles?: ReactNode;
}

/**
 * One section of /how-it-works in layered depth (lib/howItWorksDepth.ts): its
 * heading and basics, then each deeper level in a <details> nested in the one
 * before, so opening a level shows the next one's toggle. Every level is in the
 * HTML, open up to the default depth; DepthSwitch (and an inline script before
 * the first paint) open them to the reader's depth.
 */
export function DepthSection({ id, title, children, deeper, underTheHood, turtles }: Props) {
  const levels = [deeper, underTheHood, turtles];
  const shown = levels.findIndex((level) => level === undefined || level === null);
  const count = shown === -1 ? levels.length : shown;
  const nest = (index: number): ReactNode => {
    if (index >= count) return null;
    const level = (index + 2) as DepthLevel;
    return (
      <details
        className={styles.level}
        data-depth={level}
        open={level <= DEFAULT_DEPTH}
        // the inline script and DepthSwitch set `open` to the reader's depth before React hydrates
        suppressHydrationWarning
      >
        <summary className={styles.summary}>
          {depthName(level)}
          <span className="sr-only">: {title}</span>
        </summary>
        <div className={styles.content}>
          {levels[index]}
          {nest(index + 1)}
        </div>
      </details>
    );
  };
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
      {nest(0)}
    </section>
  );
}
