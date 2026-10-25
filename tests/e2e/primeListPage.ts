import { expect, type Locator, type Page, type Worker } from "@playwright/test";
import { PRIME_WORKER_NAME } from "../../lib/primes/workerNames.ts";

export const ROW_HEIGHT_PX = 44;
export const ESTIMATE_BANNER_TEXT =
  "Positions after a jump are estimated. Scroll back to 2 for exact counts.";

export interface VisibleRow {
  prime: number;
  /** The position label as shown, e.g. "#26" or "≈ #37,607,950,282". */
  label: string;
  /** The label's number, without "≈", "#" or commas. */
  ordinal: number;
  /** Distance from the top of the browser window, in px. */
  topPx: number;
}

export interface VisiblePrimeDisplay {
  /** The exact prime, from data-prime. */
  prime: string;
  /** What the row shows: the whole formatted prime, or a shortened one with "…". */
  shownText: string;
  shortened: boolean;
  /** A shortened prime's accessible name (the whole number); null when it's shown whole. */
  accessibleName: string | null;
  rowHeightPx: number;
}

/** A sieve thread: one of the workers the threaded build starts inside the prime worker. */
export function isSieveThread(worker: Worker): boolean {
  return new URL(worker.url()).pathname === "/sieve-threads/sieve.mjs";
}

/**
 * A worker's name (lib/primes/workerNames.ts), or null if it closed before it
 * could be asked. The URL can't tell workers apart: Turbopack starts each one
 * through the same loader script, with hashed chunk names in production.
 */
export async function workerName(worker: Worker): Promise<string | null> {
  try {
    return await worker.evaluate(() => self.name);
  } catch {
    return null;
  }
}

/**
 * Collects the page's prime workers as they start (not the sieve threads or
 * Miller–Rabin workers nested inside them). Each is added once its name has
 * been read, a moment after it starts.
 */
export function collectPrimeWorkers(page: Page): Worker[] {
  const workers: Worker[] = [];
  page.on("worker", async (worker) => {
    if ((await workerName(worker)) === PRIME_WORKER_NAME) workers.push(worker);
  });
  return workers;
}

/** Collects every sieve thread as it starts. */
export function collectSieveThreads(page: Page): Worker[] {
  const threads: Worker[] = [];
  page.on("worker", (worker) => {
    if (isSieveThread(worker)) threads.push(worker);
  });
  return threads;
}

/** Helpers for driving the Infinite Primes page the way a user would. */
export class PrimeListPage {
  readonly primeList: Locator;
  readonly estimateBanner: Locator;
  readonly jumpInput: Locator;
  readonly jumpFeedback: Locator;

  constructor(private readonly page: Page) {
    this.primeList = page.getByTestId("prime-list");
    this.estimateBanner = page.getByText(ESTIMATE_BANNER_TEXT);
    this.jumpInput = page.getByLabel("Jump to number");
    this.jumpFeedback = page.locator("#jump-feedback");
  }

  async open(pagePath = "/") {
    await this.page.goto(pagePath);
    await expect(this.primeList.getByTestId("prime-row").first()).toBeVisible();
    await this.waitForWorkerToFinish();
  }

  /** Jumps to `target` and waits until the jump has landed. */
  async jumpTo(target: string, options: { waitForLanding?: boolean } = {}) {
    await this.jumpInput.fill(target);
    await this.jumpInput.press("Enter");
    if (options.waitForLanding ?? true) {
      await expect(this.jumpFeedback).toContainText("Jumped to", { timeout: 60_000 });
      await this.waitForWorkerToFinish();
    }
  }

  /**
   * Scrolls the list and waits for any batch that scroll requested to arrive.
   * Positive `pixels` scrolls down (toward larger primes).
   */
  async scrollBy(pixels: number) {
    await this.primeList.evaluate((list, distance) => list.scrollBy(0, distance), pixels);
    await this.waitForWorkerToFinish();
  }

  async scrollByRows(rows: number) {
    await this.scrollBy(rows * ROW_HEIGHT_PX);
  }

  /**
   * A scroll only reaches the worker after the browser fires the scroll event
   * on the next frame, so give it a moment to start before waiting for it to finish.
   */
  async waitForWorkerToFinish() {
    await this.page.waitForTimeout(30);
    // Done = not computing and not building base primes.
    await expect(this.primeList).toHaveAttribute("data-status", /^(idle|stopped|overflow|error)$/, {
      timeout: 60_000,
    });
  }

  /** Records are saved at most once a second; wait until the latest is in storage. */
  async waitForRecordsToSave() {
    await this.page.waitForTimeout(1100);
  }

  /** Every prime row that's fully inside the list's viewport, top to bottom. */
  async visibleRows(): Promise<VisibleRow[]> {
    return this.primeList.evaluate((list) => {
      const listBox = list.getBoundingClientRect();
      return [...list.querySelectorAll<HTMLElement>('[data-testid="prime-row"]')]
        .map((row) => {
          const rowBox = row.getBoundingClientRect();
          const label = row.querySelector('[data-testid="prime-label"]')?.textContent ?? "";
          return {
            prime: Number(row.dataset.prime),
            label,
            ordinal: Number(label.replace(/[^\d]/g, "")),
            topPx: rowBox.top,
            bottomPx: rowBox.bottom,
          };
        })
        .filter((row) => row.topPx >= listBox.top - 0.5 && row.bottomPx <= listBox.bottom + 0.5)
        .sort((rowA, rowB) => rowA.topPx - rowB.topPx)
        .map(({ prime, label, ordinal, topPx }) => ({ prime, label, ordinal, topPx }));
    });
  }

  async topVisibleRow(): Promise<VisibleRow> {
    const [topRow] = await this.visibleRows();
    if (!topRow) throw new Error("no prime rows are visible");
    return topRow;
  }

  /**
   * The primes fully on screen, top to bottom, as exact BigInts read from the
   * data-prime attributes (VisibleRow.prime is a number, only exact below 2^53).
   */
  async visiblePrimesExact(): Promise<bigint[]> {
    const primeStrings = await this.primeList.evaluate((list) => {
      const listBox = list.getBoundingClientRect();
      return [...list.querySelectorAll<HTMLElement>('[data-testid="prime-row"]')]
        .filter((row) => {
          const rowBox = row.getBoundingClientRect();
          return rowBox.top >= listBox.top - 0.5 && rowBox.bottom <= listBox.bottom + 0.5;
        })
        .sort((rowA, rowB) => rowA.getBoundingClientRect().top - rowB.getBoundingClientRect().top)
        .map((row) => row.dataset.prime!);
    });
    return primeStrings.map((prime) => BigInt(prime));
  }

  /**
   * How each fully visible prime is shown, top to bottom: the exact prime
   * (data-prime), the text on screen, and, when shortened, the button that
   * opens it in full with its accessible name. With `onlyFullyVisible: false`,
   * every rendered row, including those just off screen.
   */
  async visiblePrimeDisplays({ onlyFullyVisible = true } = {}): Promise<VisiblePrimeDisplay[]> {
    return this.primeList.evaluate((list, onlyFullyVisible) => {
      const listBox = list.getBoundingClientRect();
      return [...list.querySelectorAll<HTMLElement>('[data-testid="prime-row"]')]
        .filter((row) => {
          if (!onlyFullyVisible) return true;
          const rowBox = row.getBoundingClientRect();
          return rowBox.top >= listBox.top - 0.5 && rowBox.bottom <= listBox.bottom + 0.5;
        })
        .sort((rowA, rowB) => rowA.getBoundingClientRect().top - rowB.getBoundingClientRect().top)
        .map((row) => {
          const shortenedButton = row.querySelector<HTMLElement>('button[aria-haspopup="dialog"]');
          const primeText = row.querySelector<HTMLElement>(".font-mono")?.textContent ?? "";
          return {
            prime: row.dataset.prime!,
            shownText: primeText,
            shortened: shortenedButton !== null,
            accessibleName: shortenedButton?.getAttribute("aria-label") ?? null,
            rowHeightPx: row.getBoundingClientRect().height,
          };
        });
    }, onlyFullyVisible);
  }

  /**
   * Every number the page shows for primes, positions and stats, as text: the
   * prime rows' values and labels, their data-prime attributes, and the stats.
   */
  async allDisplayedNumbers(): Promise<string[]> {
    return this.page.evaluate(() => [
      ...[...document.querySelectorAll<HTMLElement>('[data-testid="prime-row"]')].flatMap((row) => [
        row.dataset.prime!,
        row.textContent ?? "",
      ]),
      ...[...document.querySelectorAll("header dd")].map((value) => value.textContent ?? ""),
    ]);
  }

  /** Every prime currently rendered (visible or just off screen). */
  async renderedPrimes(): Promise<number[]> {
    return this.primeList
      .getByTestId("prime-row")
      .evaluateAll((rows) => rows.map((row) => Number((row as HTMLElement).dataset.prime)));
  }

  async listTopPx(): Promise<number> {
    const listBox = await this.primeList.boundingBox();
    if (!listBox) throw new Error("prime list is not on screen");
    return listBox.y;
  }
}

/** Fails with the first pair of neighbouring rows whose labels don't differ by exactly 1. */
export function expectLabelsConsecutive(rows: VisibleRow[]) {
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const rowAbove = rows[rowIndex - 1];
    const row = rows[rowIndex];
    expect(
      row.ordinal - rowAbove.ordinal,
      `labels between ${rowAbove.prime} (${rowAbove.label}) and ${row.prime} (${row.label})`,
    ).toBe(1);
  }
}
