import { expect, test } from "@playwright/test";
import { nextPrimeAfter } from "../support/primality";
import { PrimeListPage, ROW_HEIGHT_PX } from "./primeListPage";

const FIRST_500_PRIMES: string[] = [];
for (let prime = 2n; FIRST_500_PRIMES.length < 500; prime = nextPrimeAfter(prime)) {
  FIRST_500_PRIMES.push(String(prime));
}

test.describe("Wolf 359 easter egg", () => {
  test("a cube appears on 359, and on no other row in the first 500", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    const list = primeListPage.primeList;

    // Only rows near the screen are rendered, so walk down a screen at a time.
    const seen = new Set<string>();
    const withCube = new Set<string>();
    for (let screen = 0; FIRST_500_PRIMES.some((prime) => !seen.has(prime)) && screen < 100; screen++) {
      const rows = await list.getByTestId("prime-row").evaluateAll((rows) =>
        rows.map((row) => [row.getAttribute("data-prime")!, row.querySelector('[data-testid="wolf-359-cube"]') !== null] as const),
      );
      for (const [prime, hasCube] of rows) {
        seen.add(prime);
        if (hasCube) withCube.add(prime);
      }
      await list.evaluate((element) => element.scrollBy(0, element.clientHeight));
      await page.waitForTimeout(50); // let the rows near the new position render
    }

    expect(FIRST_500_PRIMES.filter((prime) => !seen.has(prime)), "every one of the first 500 was checked").toEqual([]);
    expect([...withCube].filter((prime) => FIRST_500_PRIMES.includes(prime))).toEqual(["359"]);
  });

  test("doesn't change the row: same height, same number, hidden from screen readers", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    // 359 is the 72nd prime; bring its row on screen
    await primeListPage.primeList.evaluate((element, rowHeight) => (element.scrollTop = 60 * rowHeight), ROW_HEIGHT_PX);
    const row = primeListPage.primeList.locator('[data-prime="359"]');
    await expect(row).toBeVisible();

    expect((await row.boundingBox())?.height).toBe(ROW_HEIGHT_PX);
    await expect(row.locator("span.font-mono")).toHaveText("359");
    const cube = row.getByTestId("wolf-359-cube");
    await expect(cube).toHaveAttribute("aria-hidden", "true");
    await expect(cube).toHaveAttribute("title", "Wolf 359");
    // nothing extra for screen readers: the row reads just as any other
    await expect(row.getByRole("img")).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Favorite 359" })).toBeVisible();

    // touch screens have no hover: a tap shows the same words
    await cube.click();
    await expect(row.getByText("Wolf 359")).toBeVisible();
    expect((await row.boundingBox())?.height).toBe(ROW_HEIGHT_PX);
  });

  test("the cube follows 359 to the favorites page, and only 359", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await primeListPage.primeList.evaluate((element, rowHeight) => (element.scrollTop = 60 * rowHeight), ROW_HEIGHT_PX);
    for (const prime of ["353", "359"]) {
      await primeListPage.primeList.locator(`[data-prime="${prime}"]`).getByRole("button", { name: `Favorite ${prime}` }).click();
    }
    await primeListPage.waitForRecordsToSave();

    await page.goto("/favorites");
    const wolf = page.locator('[data-favorite="359"]');
    const neighbour = page.locator('[data-favorite="353"]');
    await expect(wolf).toBeVisible();
    await expect(neighbour).toBeVisible();
    await expect(page.getByTestId("wolf-359-cube")).toHaveCount(1);
    const cube = wolf.getByTestId("wolf-359-cube");
    await expect(cube).toHaveAttribute("aria-hidden", "true");
    await expect(cube).toHaveAttribute("title", "Wolf 359");
    await cube.click();
    await expect(wolf.getByText("Wolf 359")).toBeVisible();
  });
});
