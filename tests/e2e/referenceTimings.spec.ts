import { expect, test, type Page } from "@playwright/test";
import { PrimeListPage } from "./primeListPage";

// Records what the app really does on this machine, for CLAUDE.md's reference
// timings and for decisions like the GPU's. It prints a table and asserts only
// that the list works: timings belong to the machine, not to the test. To stand
// in for a slow phone, keep Chromium on the efficiency cores (macOS):
//   taskpolicy -b npm run test:e2e:slow -- referenceTimings

const PLACES: [string, string][] = [
  ["10^6", "1000000"],
  ["10^12", "1" + "0".repeat(12)],
  ["2^53", "9007199254740992"],
  ["2^63", "9223372036854775808"],
  ["10^20", "1" + "0".repeat(20)],
  ["10^22", "1" + "0".repeat(22)],
  ["10^24", "1" + "0".repeat(24)],
];
const BATCHES_SAMPLED = 7;
const ROWS_PER_BATCH = 500;

function statValue(page: Page, label: string): Promise<string> {
  return page.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]").innerText();
}

const milliseconds = (text: string) => parseFloat(text.replace(/[^\d.]/g, ""));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function recordTimings(page: Page, label: string) {
  const primeListPage = new PrimeListPage(page);
  await primeListPage.open();
  const lines = [`${label}: ${await statValue(page, "threads")} thread(s)`];
  for (const [name, target] of PLACES) {
    const jumpStart = Date.now();
    await primeListPage.jumpTo(target);
    const landedMs = Date.now() - jumpStart;
    const setup = await statValue(page, "setup");
    const batchMs: number[] = [];
    const checkedMs: number[] = [];
    for (let sample = 0; sample < BATCHES_SAMPLED; sample++) {
      await primeListPage.scrollByRows(ROWS_PER_BATCH); // past the fetch threshold, so a batch runs
      // on slow cores the fetch may start after scrollByRows has looked: wait for rows, then for it to finish
      await expect.poll(async () => (await primeListPage.visiblePrimesExact()).length, { timeout: 60_000 }).toBeGreaterThan(0);
      await primeListPage.waitForWorkerToFinish();
      batchMs.push(milliseconds(await statValue(page, "last batch")));
      checkedMs.push(milliseconds(await statValue(page, "checked")));
    }
    lines.push(
      `${name.padEnd(6)} batch ${median(batchMs).toFixed(2).padStart(7)} ms | checked ${median(checkedMs).toFixed(2).padStart(7)} ms` +
        ` | landed ${String(landedMs).padStart(6)} ms | setup ${setup} | ${await statValue(page, "memory")}`,
    );
    await expect(page.getByRole("paragraph").filter({ hasText: /^Stopped\./ })).toHaveCount(0);
  }
  console.log(`\n${lines.join("\n")}`);
}

test.describe("reference timings", () => {
  test.setTimeout(10 * 60_000);

  test("threaded @slow", async ({ page }) => {
    await recordTimings(page, "threaded");
  });

  test("single-threaded, by the app's own fallback @slow", async ({ page }) => {
    await page.route("**/sieve-threads/**", (route) => route.abort());
    await recordTimings(page, "single-threaded");
  });
});
