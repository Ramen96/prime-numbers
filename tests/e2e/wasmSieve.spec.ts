import { expect, test } from "@playwright/test";
import { PrimeListPage, ROW_HEIGHT_PX, type VisibleRow } from "./primeListPage";

test.describe("WebAssembly sieve", () => {
  test("loads under cross-origin isolation and computes batches", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => message.type() === "error" && pageErrors.push(message.text()));
    const wasmResponse = page.waitForResponse((response) => response.url().endsWith("/sieve.wasm"));

    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();

    const response = await wasmResponse;
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/wasm");
    expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
    // The worker filled the buffer on load, so the counter has a measured rate.
    await expect(page.locator("header .font-mono").first()).toHaveText(/^\d{1,3}(,\d{3})+$/);
    expect(pageErrors).toEqual([]);
  });

  test("shows the last primes below 2^53, then says you broke math", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await primeListPage.jumpTo("9,007,199,254,740,000");

    // Primes between the jump point and 2^53 − 1 run out after a few dozen;
    // they arrive as a short batch, ending at the largest one.
    await primeListPage.scrollByRows(200);
    await expect(page.getByText("You broke math.")).toBeVisible();
    // The notice appears above the list without pushing the last rows out of view.
    const lastRows = await primeListPage.visibleRows();
    expect(lastRows[lastRows.length - 1].prime).toBe(9_007_199_254_740_881);
  });

  test("“You broke math” appearing does not move the visible rows", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    // About 520 primes before the end: the jump shows 500 of them, so the end
    // of the list (and the notice) only comes after scrolling, at any screen size.
    await primeListPage.jumpTo("9,007,199,254,721,900");
    const brokeMathNotice = page.getByText("You broke math.");
    await expect(brokeMathNotice).toBeHidden();

    // Scroll quickly until the last few primes below 2^53 are on screen...
    const PRIME_NEAR_THE_END = 9_007_199_254_740_000;
    for (let step = 0; step < 100; step++) {
      const visibleRows = await primeListPage.visibleRows();
      if (visibleRows[visibleRows.length - 1].prime >= PRIME_NEAR_THE_END) break;
      await primeListPage.scrollByRows(10);
    }
    await expect(brokeMathNotice).toBeHidden();

    // ...then step down one row at a time. The notice appears when the list
    // asks for primes past the last one. Only the one-row scroll itself may
    // move rows: up by one row, or not at all if the list was already at the
    // bottom. Without the fix, the notice would push every row down.
    let rowsBefore: VisibleRow[] = await primeListPage.visibleRows();
    let rowsAfter: VisibleRow[] = rowsBefore;
    let oneRowSteps = 0;
    while (oneRowSteps < 100 && !(await brokeMathNotice.isVisible())) {
      rowsBefore = rowsAfter;
      await primeListPage.scrollByRows(1);
      rowsAfter = await primeListPage.visibleRows();
      oneRowSteps++;
    }
    await expect(brokeMathNotice).toBeVisible();
    expect(oneRowSteps).toBeGreaterThan(0);

    const topPxBeforeByPrime = new Map(rowsBefore.map((row) => [row.prime, row.topPx]));
    const rowsVisibleBeforeAndAfter = rowsAfter.filter((row) => topPxBeforeByPrime.has(row.prime));
    expect(rowsVisibleBeforeAndAfter.length).toBeGreaterThan(3);
    const distancesMovedPx = rowsVisibleBeforeAndAfter.map(
      (row) => row.topPx - topPxBeforeByPrime.get(row.prime)!,
    );
    for (const distanceMovedPx of distancesMovedPx) {
      expect(distanceMovedPx).toBeCloseTo(distancesMovedPx[0], 0); // all rows moved together
      expect(distanceMovedPx).toBeGreaterThanOrEqual(-ROW_HEIGHT_PX - 0.5);
      expect(distanceMovedPx).toBeLessThanOrEqual(0.5);
    }
    // And the last prime below 2^53 is still in view.
    expect(rowsAfter[rowsAfter.length - 1].prime).toBe(9_007_199_254_740_881);
  });
});
