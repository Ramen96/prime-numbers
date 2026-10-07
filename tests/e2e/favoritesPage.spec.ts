import { expect, test } from "@playwright/test";

const STORAGE_KEY = "everyPrimeNumber.personalData";

/** The first `count` primes, as decimal strings. */
function firstPrimes(count: number): string[] {
  const limit = 60_000;
  const isComposite = new Uint8Array(limit);
  const primes: string[] = [];
  for (let candidate = 2; candidate < limit && primes.length < count; candidate++) {
    if (isComposite[candidate]) continue;
    primes.push(String(candidate));
    for (let multiple = candidate * candidate; multiple < limit; multiple += candidate) isComposite[multiple] = 1;
  }
  return primes;
}

test.describe("/favorites for search engines", () => {
  test("has noindex and isn't in the sitemap", async ({ request }) => {
    const html = await (await request.get("/favorites")).text();
    expect(html).toContain('<meta name="robots" content="noindex, follow"/>');
    expect(html).toMatch(/<h1[^>]*>Favorite primes<\/h1>/);
    expect(html).toContain("<title>Your Favorite Primes | Every Prime Number</title>");

    const sitemapXml = await (await request.get("/sitemap.xml")).text();
    expect(sitemapXml).not.toContain("/favorites");
  });
});

test("the prime list and the favorites list use the same scrollbar styles", async ({ page }) => {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify({ version: 1, favorites: ["13"], records: {} })],
  );
  const themedScrollbarClass = (classes: string) =>
    classes.split(/\s+/).find((className) => className.includes("themedScrollbar"));

  await page.goto("/");
  const primeListClasses = await page.getByTestId("prime-list").getAttribute("class");
  await page.goto("/favorites");
  const favoritesListClasses = await page.getByTestId("favorites-scroll-container").getAttribute("class");

  expect(themedScrollbarClass(primeListClasses!)).toBeTruthy();
  expect(themedScrollbarClass(favoritesListClasses!)).toBe(themedScrollbarClass(primeListClasses!));
});

test("5,000 favorites render and scroll without 5,000 rows in the page", async ({ page }) => {
  const favorites = firstPrimes(5000);
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify({ version: 1, favorites, records: {} })],
  );
  await page.goto("/favorites");
  await expect(page.getByTestId("favorites-count")).toHaveText("5,000 favorites");

  const rows = page.getByRole("list", { name: "Favorite primes" }).getByRole("listitem");
  await expect(rows.first()).toHaveText(/^2View in list/);
  expect(await rows.count()).toBeLessThan(100);

  // Scroll to the end: the last favorite shows up, and the page still holds only a few rows.
  const scrollContainer = page.getByTestId("favorites-scroll-container");
  for (let attempt = 0; attempt < 3; attempt++) {
    await scrollContainer.evaluate((container) => container.scrollTo(0, container.scrollHeight));
    await page.waitForTimeout(100); // estimated heights settle as rows are measured
  }
  const lastFavorite = Number(favorites[favorites.length - 1]).toLocaleString("en-US");
  await expect(rows.filter({ hasText: lastFavorite })).toBeVisible();
  expect(await rows.count()).toBeLessThan(100);
  expect(await rows.last().getAttribute("aria-posinset")).toBe("5000");
});

test.describe("/favorites layout", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("never scrolls sideways at 360px", async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [STORAGE_KEY, JSON.stringify({ version: 1, favorites: ["13", "9000000000000000037", (2n ** 200n + 235n).toString()], records: {} })],
    );
    await page.goto("/favorites");
    await expect(page.getByTestId("favorites-count")).toHaveText("3 favorites");
    const widths = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      list: document.querySelector('[data-testid="favorites-scroll-container"]')!.scrollWidth,
    }));
    expect(widths.page).toBeLessThanOrEqual(360);
    expect(widths.list).toBeLessThanOrEqual(360);
  });
});
