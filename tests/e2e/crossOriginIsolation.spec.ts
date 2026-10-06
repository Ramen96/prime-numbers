import { expect, test } from "@playwright/test";
import { PrimeListPage } from "./primeListPage";

// Cross-origin isolation gives performance.now() fine enough precision to
// time small batches (see next.config.ts).
test.describe("cross-origin isolation", () => {
  test("the page response includes the COOP and COEP headers", async ({ request }) => {
    const response = await request.get("/");
    expect(response.headers()["cross-origin-opener-policy"]).toBe("same-origin");
    expect(response.headers()["cross-origin-embedder-policy"]).toBe("require-corp");
  });

  test("the page is cross-origin isolated and nothing it loads is blocked", async ({ page }) => {
    const blockedRequests: string[] = [];
    page.on("requestfailed", (request) => blockedRequests.push(request.url()));
    page.on("response", (response) => {
      if (response.status() >= 400) blockedRequests.push(`${response.status()} ${response.url()}`);
    });

    const primeListPage = new PrimeListPage(page);
    await primeListPage.open(); // the worker ran: primes are on screen

    expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
    expect(blockedRequests).toEqual([]);
  });
});
