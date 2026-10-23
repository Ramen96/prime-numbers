import type { CSSProperties } from "react";
import { sieveAnimation } from "@/lib/sieveAnimation";
import styles from "./NotFoundSieve.module.scss";

const FIRST_NUMBER = 400;
const LAST_NUMBER = 409;
const NOT_FOUND = 404;

/**
 * The 404 page's sieve of Eratosthenes on 400–409: one pass per prime, each
 * crossing out the numbers it reaches first, then the survivors light up.
 * CSS only (no JavaScript), and shown already finished under reduced motion.
 * The grid is hidden from screen readers; the caption says the same thing.
 */
export function NotFoundSieve() {
  const { cells, survivors } = sieveAnimation(FIRST_NUMBER, LAST_NUMBER);

  return (
    <figure className="my-8">
      <ol aria-hidden="true" className="grid grid-cols-5 gap-2" data-testid="not-found-sieve">
        {cells.map((cell) => (
          <li
            key={cell.value}
            className={[
              styles.cell,
              cell.crossedOutBy === null ? styles.survivor : styles.crossedOut,
              cell.value === NOT_FOUND ? styles.notFound : "",
            ].join(" ")}
            style={{ "--pass": cell.pass } as CSSProperties}
            data-crossed-out-by={cell.crossedOutBy ?? undefined}
          >
            <span className={styles.number}>{cell.value}</span>
            {cell.crossedOutBy !== null && <span className={styles.factor}>by {cell.crossedOutBy}</span>}
          </li>
        ))}
      </ol>
      <figcaption className="mt-3 text-sm text-muted">
        The sieve of Eratosthenes on {FIRST_NUMBER} to {LAST_NUMBER}: each number is crossed out by its smallest
        prime factor, and {NOT_FOUND} goes in the first pass, with 2. Only {survivors.join(" and ")} survive.
      </figcaption>
    </figure>
  );
}
