import { expect, test, type Page } from "@playwright/test";
import { nextPrimeAfter, previousPrimeBefore } from "../support/primality";
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

  test("a jump far past what fits in memory is sieved partially: every prime proven, no notice", async ({ page }) => {
    // Sieving fully near 10^24 would need every prime up to 10^12: far more than fits.
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => message.type() === "error" && pageErrors.push(message.text()));
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await primeListPage.jumpTo("1" + "0".repeat(24));
    await primeListPage.scrollByRows(600); // into a batch fetched by scrolling

    const primes = await primeListPage.visiblePrimesExact();
    expect(primes[0]).toBeGreaterThan(10n ** 24n);
    for (let index = 1; index < primes.length; index++) {
      expect(primes[index], `the prime after ${primes[index - 1]}`).toBe(nextPrimeAfter(primes[index - 1]));
    }
    await expect(page.getByText("This device’s memory limit.")).toBeHidden();
    await expect(primeListPage.primeList).not.toHaveAttribute("data-status", "error");
    expect(pageErrors).toEqual([]);
  });

  test("a jump of any size is answered, not a crash: past 10^600 too", async ({ page }) => {
    // That far out, a batch takes far longer than a test: it only has to start, without errors.
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => message.type() === "error" && pageErrors.push(message.text()));
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    for (const zeros of [600, 5000]) {
      await primeListPage.jumpTo("1" + "0".repeat(zeros), { waitForLanding: false });
      await expect(primeListPage.primeList).toHaveAttribute("data-status", "computing");
      await page.waitForTimeout(500);
      await expect(primeListPage.primeList).toHaveAttribute("data-status", "computing");
    }
    expect(pageErrors).toEqual([]);
  });

  test("going up across a(13), the list keeps going: every prime proven, none skipped", async ({ page }) => {
    const provenBound = 3_317_044_064_679_887_385_961_981n; // OEIS A014233, a(13)
    const pageErrors = collectErrors(page);
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await primeListPage.jumpTo("3,317,044,064,679,887,385,958,000");
    // bring the last prime below a(13) to the second row, so the first prime past it is just under it,
    // however many rows the screen shows: count the primes from the top row to it with the test reference
    const lastBelowTheBound = previousPrimeBefore(provenBound)!;
    let rowsDown = 0;
    for (let prime = (await primeListPage.visiblePrimesExact())[0]; prime < lastBelowTheBound; prime = nextPrimeAfter(prime)) rowsDown++;
    await primeListPage.scrollByRows(rowsDown - 1);
    const acrossTheBound = await primeListPage.visiblePrimesExact();
    expect(acrossTheBound).toContain(previousPrimeBefore(provenBound));
    expect(acrossTheBound).toContain(nextPrimeAfter(provenBound));
    expectConsecutivePrimes(acrossTheBound);

    await primeListPage.scrollByRows(600); // into a batch fetched by scrolling, all past a(13)
    const pastTheBound = await primeListPage.visiblePrimesExact();
    expect(pastTheBound[0]).toBeGreaterThan(provenBound);
    expectConsecutivePrimes(pastTheBound);
    await expect(primeListPage.primeList).not.toHaveAttribute("data-status", "error");
    expect(pageErrors).toEqual([]);
  });

  for (const digits of [26, 61]) {
    test(`a jump to 10^${digits - 1} shows proven primes from there on, none skipped`, async ({ page }) => {
      await expectProvenPrimesAfterJump(page, 10n ** BigInt(digits - 1));
    });
  }

  test("primes past a(13) appear as they're proven, long before their batch is done", async ({ page }) => {
    // A whole batch past 10^100 takes about a minute; its first primes take seconds.
    const pageErrors = collectErrors(page);
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    const target = 10n ** 100n;
    await primeListPage.jumpInput.fill(String(target));
    await primeListPage.jumpInput.press("Enter");
    await expect(primeListPage.jumpFeedback).toContainText("Jumped to", { timeout: 25_000 });
    await expect(primeListPage.primeList).toHaveAttribute("data-status", "computing"); // the batch isn't done
    await expect(primeListPage.primeList.getByText(/^proving primality…/)).toBeAttached(); // the row at the end
    const shown = await primeListPage.renderedPrimes();
    expect(shown.length).toBeGreaterThan(0);
    const primes = await primeListPage.visiblePrimesExact();
    expect(primes[0]).toBe(nextPrimeAfter(target - 1n));
    if (primes.length > 1) expectConsecutivePrimes(primes);
    expect(pageErrors).toEqual([]);
  });

  test("primes past a(13) proven once aren't proven again: a second visit is much faster", async ({ page }) => {
    const pageErrors = collectErrors(page);
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    const timedJump = async (target: string) => {
      const start = Date.now();
      await primeListPage.jumpTo(target);
      return Date.now() - start;
    };
    // 10^50: proofs dominate a first visit, but it's quick enough not to load the other tests running alongside
    const firstVisitMs = await timedJump("1" + "0".repeat(50));
    const firstVisitPrimes = await primeListPage.visiblePrimesExact();
    await primeListPage.jumpTo("1,000");
    const secondVisitMs = await timedJump("1" + "0".repeat(50));
    expect(await primeListPage.visiblePrimesExact()).toEqual(firstVisitPrimes);
    expect(secondVisitMs, `first visit ${firstVisitMs} ms`).toBeLessThan(firstVisitMs / 3);
    expect(pageErrors).toEqual([]);
  });

  test("a jump to 10^100 shows proven primes from there on, none skipped @slow", async ({ page }) => {
    test.setTimeout(600_000);
    await expectProvenPrimesAfterJump(page, 10n ** 100n, { timeoutMs: 540_000 });
  });
});

/** Every error the page reports, as it happens. */
function collectErrors(page: Page): string[] {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => message.type() === "error" && pageErrors.push(message.text()));
  return pageErrors;
}

/** Each prime is the one right after the last (by the independent test reference): none skipped. */
function expectConsecutivePrimes(primes: bigint[]) {
  expect(primes.length).toBeGreaterThan(1);
  for (let index = 1; index < primes.length; index++) {
    expect(primes[index], `the prime after ${primes[index - 1]}`).toBe(nextPrimeAfter(primes[index - 1]));
  }
}

/** Jumps to `target` past a(13): the list starts at the first prime after it, and continues without a gap. */
async function expectProvenPrimesAfterJump(page: Page, target: bigint, { timeoutMs = 60_000 } = {}) {
  const pageErrors = collectErrors(page);
  const primeListPage = new PrimeListPage(page);
  await primeListPage.open();
  await primeListPage.jumpInput.fill(String(target));
  await primeListPage.jumpInput.press("Enter");
  await expect(primeListPage.jumpFeedback).toContainText("Jumped to", { timeout: timeoutMs });
  await expect(primeListPage.primeList).toHaveAttribute("data-status", /^(idle|stopped|overflow|error)$/, {
    timeout: timeoutMs,
  });
  await expect(primeListPage.primeList).not.toHaveAttribute("data-status", "error");

  const primes = await primeListPage.visiblePrimesExact();
  expect(primes[0]).toBe(nextPrimeAfter(target - 1n));
  expectConsecutivePrimes(primes);
  await expect(page.getByText("This device’s memory limit.")).toBeHidden();
  expect(pageErrors).toEqual([]);
}
