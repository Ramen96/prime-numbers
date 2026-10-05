import { expect, test } from "@playwright/test";
import { PrimeListPage, ROW_HEIGHT_PX, type VisibleRow } from "./primeListPage";

test.describe("estimate banner", () => {
  test("is hidden on app start", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();

    await expect(primeListPage.estimateBanner).toBeHidden();
    const topRow = await primeListPage.topVisibleRow();
    expect(topRow).toMatchObject({ prime: 2, label: "#1" });
  });

  test("jumping to 10^12 lands the first prime directly below the banner", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await primeListPage.jumpTo("1,000,000,000,000");

    await expect(primeListPage.estimateBanner).toBeVisible();
    const bannerBox = await primeListPage.estimateBanner.boundingBox();
    const listTopPx = await primeListPage.listTopPx();
    // The banner sits above the list, not over it...
    expect(bannerBox!.y + bannerBox!.height).toBeCloseTo(listTopPx, 0);
    // ...and the first prime ≥ 10^12 is the first row below it.
    const topRow = await primeListPage.topVisibleRow();
    expect(topRow.prime).toBe(1_000_000_000_039);
    expect(topRow.label).toMatch(/^≈ #/);
    expect(topRow.topPx).toBeCloseTo(listTopPx, 0);
  });

  test("stays put while the list scrolls", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await primeListPage.jumpTo("1,000,000,000");
    const bannerBoxBeforeScrolling = await primeListPage.estimateBanner.boundingBox();

    for (const rowsToScroll of [40, -80, 120]) {
      await primeListPage.scrollByRows(rowsToScroll);
      await expect(primeListPage.estimateBanner).toBeVisible();
      expect(await primeListPage.estimateBanner.boundingBox()).toEqual(bannerBoxBeforeScrolling);
    }
  });

  test("jumping to 100 shows 101 as #26 with exact labels and no banner", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await primeListPage.jumpTo("1,000,000,000"); // start from estimated labels
    await primeListPage.jumpTo("100");

    await expect(primeListPage.estimateBanner).toBeHidden();
    const topRow = await primeListPage.topVisibleRow();
    expect(topRow).toMatchObject({ prime: 101, label: "#26" });
    expect(topRow.topPx).toBeCloseTo(await primeListPage.listTopPx(), 0);
  });

  test("hiding the banner does not move the visible rows", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();

    // 8,831 is prime #1,100. The jump shows primes #600–#1,599 with estimated
    // labels. Scrolling up to about #800 fetches #100–#599, which don't reach
    // 2, so the banner stays. Scrolling on up to about #300 (prime 1,987)
    // fetches #1–#99, which contains 2, and the banner hides.
    await primeListPage.jumpTo("8831");
    await expect(primeListPage.estimateBanner).toBeVisible();

    // Scroll quickly to just before the banner is due to hide...
    const PRIME_SHORTLY_BEFORE_BANNER_HIDES = 2_300; // about #340
    while ((await primeListPage.topVisibleRow()).prime > PRIME_SHORTLY_BEFORE_BANNER_HIDES) {
      await primeListPage.scrollByRows(-10);
      await expect(primeListPage.estimateBanner).toBeVisible();
    }

    // ...then one row at a time, so we can compare the rows just before and
    // just after the banner hides. The only movement should be the one-row
    // scroll itself.
    let rowsBefore: VisibleRow[] = await primeListPage.visibleRows();
    let rowsAfter: VisibleRow[] = rowsBefore;
    for (let step = 0; step < 200 && (await primeListPage.estimateBanner.isVisible()); step++) {
      rowsBefore = rowsAfter;
      await primeListPage.scrollByRows(-1);
      rowsAfter = await primeListPage.visibleRows();
    }
    await expect(primeListPage.estimateBanner).toBeHidden();

    const topPxBeforeByPrime = new Map(rowsBefore.map((row) => [row.prime, row.topPx]));
    const rowsVisibleBeforeAndAfter = rowsAfter.filter((row) => topPxBeforeByPrime.has(row.prime));
    expect(rowsVisibleBeforeAndAfter.length).toBeGreaterThan(5);
    for (const row of rowsVisibleBeforeAndAfter) {
      const distanceMovedPx = row.topPx - topPxBeforeByPrime.get(row.prime)!;
      expect(distanceMovedPx, `prime ${row.prime} moved`).toBeCloseTo(ROW_HEIGHT_PX, 0);
    }
    // And the labels are exact now.
    expect(rowsAfter.every((row) => !row.label.startsWith("≈"))).toBe(true);
  });
});
