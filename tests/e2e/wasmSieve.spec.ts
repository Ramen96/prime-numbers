import { expect, test } from "@playwright/test";
import { nextPrimeAfter } from "../support/primality";
import { PrimeListPage } from "./primeListPage";

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

  test("keeps going past 2^53, the old limit, with every prime proven and none skipped", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await primeListPage.jumpTo("9,007,199,254,740,000");
    await primeListPage.scrollByRows(600); // past 2^53, and into a batch fetched by scrolling

    const primes = await primeListPage.visiblePrimesExact();
    expect(primes[0]).toBeGreaterThan(2n ** 53n);
    for (let index = 1; index < primes.length; index++) {
      expect(primes[index], `the prime after ${primes[index - 1]}`).toBe(nextPrimeAfter(primes[index - 1]));
    }
    await expect(page.getByText("This device’s memory limit.")).toBeHidden();
  });

  test("a jump past what this device can sieve shows the memory limit, not an error or a guess", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => message.type() === "error" && pageErrors.push(message.text()));
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();

    // Sieving near 10^30 needs every prime up to 10^15: far more than fits in memory.
    await primeListPage.jumpInput.fill("1,000,000,000,000,000,000,000,000,000,000");
    await primeListPage.jumpInput.press("Enter");
    await expect(page.getByText("This device’s memory limit.")).toBeVisible();
    await expect(primeListPage.primeList.getByTestId("prime-row")).toHaveCount(0); // nothing guessed
    await expect(primeListPage.primeList).not.toHaveAttribute("data-status", "error");
    expect(pageErrors).toEqual([]);

    // Jumping back somewhere reachable clears it.
    await primeListPage.jumpTo("1,000");
    await expect(page.getByText("This device’s memory limit.")).toBeHidden();
    expect((await primeListPage.topVisibleRow()).prime).toBe(1009);
  });
});
