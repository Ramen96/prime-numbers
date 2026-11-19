import { expect, test, type Page } from "@playwright/test";
import { nextPrimeAfter } from "../support/primality";
import { forceSingleThreadedBuild, PrimeListPage } from "./primeListPage";

// The single-threaded build (public/sieve.wasm) at the sizes only proofs reach.
// The threaded build is covered by wasmSieve.spec.ts; this is the same engine
// compiled without threads, which every device without them gets.

function collectErrors(page: Page): string[] {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => message.type() === "error" && pageErrors.push(message.text()));
  return pageErrors;
}

async function openOnTheSingleThreadedBuild(page: Page): Promise<PrimeListPage> {
  await forceSingleThreadedBuild(page);
  const primeListPage = new PrimeListPage(page);
  await primeListPage.open();
  const threads = page.locator("dt", { hasText: "threads" }).locator("xpath=following-sibling::dd[1]");
  await expect(threads).toHaveText("1");
  return primeListPage;
}

test.describe("the single-threaded build", () => {
  test("proves primes past a(13): at 10^60 they appear in order, none skipped", async ({ page }) => {
    test.setTimeout(120_000);
    const pageErrors = collectErrors(page);
    const primeListPage = await openOnTheSingleThreadedBuild(page);
    const target = 10n ** 60n;
    // On one thread a whole batch takes a while, so this checks the first primes streamed in.
    await primeListPage.jumpTo(String(target), { waitForLanding: false });
    await expect(primeListPage.jumpFeedback).toContainText("Jumped to", { timeout: 90_000 });

    // at least 5: about all that's on screen at phone size
    await expect
      .poll(async () => (await primeListPage.visiblePrimesExact()).length, { timeout: 90_000 })
      .toBeGreaterThanOrEqual(5);
    const primes = await primeListPage.visiblePrimesExact();
    expect(primes[0]).toBe(nextPrimeAfter(target - 1n));
    for (let index = 1; index < primes.length; index++) {
      expect(primes[index], `the prime after ${primes[index - 1]}`).toBe(nextPrimeAfter(primes[index - 1]));
    }
    await expect(primeListPage.primeList).not.toHaveAttribute("data-status", "error");
    expect(pageErrors).toEqual([]);
  });

  test("answers a jump of any size, not a crash: 10^5000 and a million digits", async ({ page }) => {
    test.setTimeout(120_000);
    const pageErrors = collectErrors(page);
    const primeListPage = await openOnTheSingleThreadedBuild(page);
    // That far out, a batch takes far longer than a test: it only has to start, and keep
    // going without errors (a million digits is about 104,000 limbs across the Wasm boundary).
    for (const target of ["1" + "0".repeat(5000), "1" + "0".repeat(999_999)]) {
      await primeListPage.jumpTo(target, { waitForLanding: false });
      await expect(primeListPage.primeList).toHaveAttribute("data-status", "computing");
      await page.waitForTimeout(5_000);
      await expect(primeListPage.primeList).toHaveAttribute("data-status", "computing");
      expect(new URL(page.url()).searchParams.get("jump")).toBe(target);
    }
    expect(pageErrors).toEqual([]);
  });
});
