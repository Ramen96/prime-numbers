import { expect, test, type Page } from "@playwright/test";
import { CALCULATING_LINES, MEMORY_LIMIT_LINES } from "../../lib/mentatLines";
import { PrimeListPage } from "./primeListPage";

const MEMORY_NOTICE =
  "This device’s memory limit. Going further needs more base primes than fit in its memory, so the list stops at the last prime it could prove. Nothing after it has been skipped or guessed; it just hasn’t been checked.";

/**
 * Replaces the easter egg's random source (lib/mentatLines.ts) before the
 * page loads: `values` are returned in turn, over and over. A later call
 * replaces an earlier one.
 */
async function forceRandom(page: Page, values: number[]) {
  await page.addInitScript((values) => {
    let call = 0;
    (window as unknown as { everyPrimeNumberMentatRandom: () => number }).everyPrimeNumberMentatRandom = () =>
      values[call++ % values.length];
  }, values);
}

/** Forced on, picking line `index` of a list of `count` (the chance draw, then the line draw). */
const forcedOnPicking = (index: number, count: number) => [0, (index + 0.5) / count];
const FORCED_OFF = [0.999];

/** Holds the sieve back, so the page stays calculating with no rate measured yet. */
async function holdTheSieveBack(page: Page) {
  await page.route("**/sieve.wasm", () => {}); // never answered
}

const counter = (page: Page) => page.locator("header .font-mono").first();

test.describe("Mentat easter egg", () => {
  test("while calculating, forced on: each line can appear in place of the dash, and fits", async ({ page }) => {
    await holdTheSieveBack(page);
    await forceRandom(page, FORCED_OFF);
    await page.goto("/");
    await expect(counter(page)).toHaveText("—");
    const dashCounterHeight = (await counter(page).boundingBox())!.height;
    const headerHeight = (await page.locator("header").boundingBox())!.height;

    for (const [index, line] of CALCULATING_LINES.entries()) {
      await forceRandom(page, forcedOnPicking(index, CALCULATING_LINES.length));
      await page.goto("/");
      const mentatLine = counter(page).getByTestId("mentat-line");
      await expect(mentatLine).toHaveText(line);

      // not cut off by its two-line limit, and nothing around it moved
      const fits = await mentatLine.locator("span").evaluate((text) => text.scrollHeight <= text.clientHeight + 1);
      expect(fits, `"${line}" fits`).toBe(true);
      expect((await counter(page).boundingBox())!.height).toBeCloseTo(dashCounterHeight, 0);
      expect((await page.locator("header").boundingBox())!.height).toBeCloseTo(headerHeight, 0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });

  test("while calculating, forced off: just the dash", async ({ page }) => {
    await holdTheSieveBack(page);
    await forceRandom(page, FORCED_OFF);
    await page.goto("/");
    await expect(counter(page)).toHaveText("—");
    await expect(page.getByTestId("mentat-line")).toHaveCount(0);
  });

  test("at the memory limit, forced on: each line can appear below the notice, which is unchanged", async ({ page }) => {
    for (const [index, line] of MEMORY_LIMIT_LINES.entries()) {
      await forceRandom(page, forcedOnPicking(index, MEMORY_LIMIT_LINES.length));
      const primeListPage = new PrimeListPage(page);
      await primeListPage.open();
      await primeListPage.jumpTo("1" + "0".repeat(30), { waitForLanding: false });

      const notice = page.getByRole("status").filter({ hasText: "This device’s memory limit." });
      await expect(notice).toHaveText(MEMORY_NOTICE);
      const mentatLine = page.getByTestId("mentat-line").filter({ hasText: line });
      await expect(mentatLine).toBeVisible();
      // never announced: not inside any live region
      expect(await mentatLine.evaluate((element) => element.closest("[aria-live], [role=status], [role=alert]"))).toBeNull();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });

  test("at the memory limit, forced off: the notice alone, unchanged", async ({ page }) => {
    await forceRandom(page, FORCED_OFF);
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await primeListPage.jumpTo("1" + "0".repeat(30), { waitForLanding: false });
    await expect(page.getByRole("status").filter({ hasText: "This device’s memory limit." })).toHaveText(MEMORY_NOTICE);
    await expect(page.getByTestId("mentat-line")).toHaveCount(0);
  });
});
