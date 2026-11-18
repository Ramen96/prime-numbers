import { expect, test, type Page } from "@playwright/test";
import { CALCULATING_LINES, PROVING_LINES } from "../../lib/mentatLines";
import { PrimeListPage } from "./primeListPage";

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

  test("while proving past a(13), forced on: each line can appear in the row, which stays the same height", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    for (const [index, line] of PROVING_LINES.entries()) {
      await forceRandom(page, forcedOnPicking(index, PROVING_LINES.length));
      const primeListPage = new PrimeListPage(page);
      await primeListPage.open();
      await primeListPage.jumpTo("1" + "0".repeat(100), { waitForLanding: false });
      const mentatLine = primeListPage.primeList.getByTestId("proving-mentat-line");
      await expect(mentatLine).toHaveText(line, { timeout: 20_000 });
      // never announced, and the row is still one row
      expect(await mentatLine.evaluate((element) => element.closest("[aria-live], [role=status], [role=alert]"))).toBeNull();
      expect(await mentatLine.getAttribute("aria-hidden")).toBe("true");
      expect((await mentatLine.locator("..").boundingBox())!.height).toBeCloseTo(44, 0);
      await expect(primeListPage.primeList.getByText("proving primality…", { exact: false })).toBeAttached();
    }
  });

  test("while proving past a(13), forced off: the row just says it's proving", async ({ page }) => {
    await forceRandom(page, FORCED_OFF);
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await primeListPage.jumpTo("1" + "0".repeat(100), { waitForLanding: false });
    await expect(primeListPage.primeList.getByText(/^proving primality…/)).toBeVisible({ timeout: 20_000 });
    await expect(primeListPage.primeList.getByTestId("proving-mentat-line")).toHaveCount(0);
  });
});
