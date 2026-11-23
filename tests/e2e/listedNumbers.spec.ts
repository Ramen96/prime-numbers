import { expect, test, type Page } from "@playwright/test";
import { listedNumbers } from "../../lib/listedNumbers.ts";

// A listed number's own page, built ahead of time (app/is-prime/[n], lib/listedNumbers.ts):
// its answer in the HTML, a 404 for any other number, and the checker's form
// opening the right page.

const MERSENNE_607 = 2n ** 607n - 1n;
const A13 = 3_317_044_064_679_887_385_961_981n;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  return errors;
}

async function checkNumber(page: Page, typed: string) {
  await page.getByRole("textbox", { name: "Number" }).fill(typed);
  await page.getByRole("button", { name: "Check", exact: true }).click();
}

test.describe("a listed number's page, without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("has its answer, evidence and note in the HTML", async ({ page }) => {
    await page.goto("/is-prime/91");
    await expect(page).toHaveTitle("Is 91 prime? No: 91 = 7 × 13 | Every Prime Number");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Is 91 prime?");
    await expect(page.getByTestId("prime-check-headline")).toHaveText("91 isn’t prime: it’s divisible by 7.");
    await expect(page.getByTestId("prime-check-result")).toContainText("91 = 7 × 13.");
    expect(await page.locator('meta[name="description"]').getAttribute("content")).toBe("91 isn’t prime: it’s divisible by 7. 91 = 7 × 13.");
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toMatch(/\/is-prime\/91$/);

    await page.goto(`/is-prime/${A13}`);
    await expect(page.getByTestId("prime-check-headline")).toContainText("fails the strong Lucas test");
    await expect(page.getByTestId("prime-check-note")).toContainText("passes Miller–Rabin with all of the first 13 primes");
  });

  test("shows a big prime's certificate, checked when the page was built", async ({ page }) => {
    await page.goto(`/is-prime/${MERSENNE_607}`);
    await expect(page).toHaveTitle(/^Is 531,137,992,816,…,031,728,127 prime\? Yes, with a proof/);
    await expect(page.getByTestId("prime-check-result")).toContainText(
      "Proven by the elliptic curve certificate below, checked step by step when this page was built.",
    );
    await expect(page.getByTestId("certificate-steps").getByRole("listitem")).toHaveCount(19);
    await expect(page.getByTestId("prime-check-note")).toContainText("Raphael Robinson");
  });

  test("links to its neighbours", async ({ page }) => {
    await page.goto("/is-prime/1000");
    const nearby = page.getByRole("navigation", { name: "Nearby numbers" });
    await expect(nearby.getByRole("link")).toHaveText(["← 999", "1,729 →"]);
    await page.goto("/is-prime/0");
    await expect(page.getByRole("navigation", { name: "Nearby numbers" }).getByRole("link")).toHaveText(["1 →"]);
  });
});

test.describe("listed number pages", () => {
  test("exist only for listed numbers, and all of them are in the sitemap", async ({ request }) => {
    expect((await request.get("/is-prime/1001")).status()).toBe(404);
    expect((await request.get("/is-prime/91")).status()).toBe(200);
    const sitemapXml = await (await request.get("/sitemap.xml")).text();
    const listedInSitemap = sitemapXml.match(/\/is-prime\/\d+<\/loc>/g) ?? [];
    expect(listedInSitemap.length).toBe(listedNumbers().length);
    expect(sitemapXml).toContain(`/is-prime/${MERSENNE_607}</loc>`);
  });

  test("the form opens a listed number's page, and an old ?n= link is replaced by it", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/is-prime");
    await checkNumber(page, "1,000,003");
    await expect(page).toHaveURL(/\/is-prime\/1000003$/);
    await expect(page.getByTestId("prime-check-note")).toHaveText("The first prime after a million.");

    // on a listed page, an unlisted number goes to the checker
    await checkNumber(page, "1001");
    await expect(page).toHaveURL(/\/is-prime\?n=1001$/);
    await expect(page.getByTestId("prime-check-headline")).toHaveText("1,001 isn’t prime: it’s divisible by 7.");

    await page.goto("/is-prime?n=73");
    await expect(page).toHaveURL(/\/is-prime\/73$/);
    await expect(page.getByTestId("prime-check-headline")).toHaveText("73 is prime.");
    await page.getByRole("link", { name: "74 →" }).click();
    await expect(page).toHaveURL(/\/is-prime\/74$/);
    await expect(page.getByTestId("prime-check-headline")).toHaveText("74 isn’t prime: it’s even.");
    expect(errors).toEqual([]);
  });

  test("long numbers fit a 320 px screen, with 44 px buttons", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const value of [MERSENNE_607, A13, 10n ** 100n + 267n, 2n ** 67n - 1n, 12_345_678_901_234_567_891n]) {
      await page.goto(`/is-prime/${value}`);
      await expect(page.getByTestId("prime-check-headline")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), String(value)).toBe(0);
      for (const button of await page.getByTestId("prime-check-actions").getByRole("button").all())
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
});
