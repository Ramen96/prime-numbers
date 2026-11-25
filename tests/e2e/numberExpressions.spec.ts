import { expect, test, type Browser } from "@playwright/test";
import { nextPrimeAfter } from "../support/primality";
import { PrimeListPage } from "./primeListPage";

// Numbers written as 1e100, 1.5e3 or 2^100 + 7 (lib/wholeNumberExpression.ts), in
// the jump box, ?jump=, the prime checker and its ?n=.

/**
 * Where the browser itself sends a form with `typed` in it, as it would before the
 * page's script runs: /is-prime's (the default) or the jump box on /.
 */
async function nativelySubmitted(browser: Browser, typed: string, form: "checker" | "jump" = "checker"): Promise<string> {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(form === "checker" ? "/is-prime" : "/");
  await page.getByRole("textbox", { name: form === "checker" ? "Number" : "Jump to number" }).fill(typed);
  await page.getByRole("button", { name: form === "checker" ? "Check" : "Jump", exact: true }).click();
  await page.waitForURL(/\?number=/);
  const address = new URL(page.url());
  await context.close();
  return address.pathname + address.search;
}

/** The first prime at or after `value`, by the test reference. */
const firstPrimeFrom = (value: bigint) => nextPrimeAfter(value - 1n);

test.describe("numbers written as expressions", () => {
  test("a jump to 2^100 + 7 lands on the first prime after it, says its digit count, and keeps it short in the URL", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await expect(primeListPage.jumpInput).toHaveAttribute("inputmode", "text");

    await primeListPage.jumpTo("2^100 + 7");
    const target = 2n ** 100n + 7n;
    const [topPrime] = await primeListPage.visiblePrimesExact();
    expect(topPrime).toBe(firstPrimeFrom(target));
    await expect(primeListPage.jumpFeedback).toContainText(/\(first prime ≥ .*, 31 digits\)$/);
    await expect(page).toHaveURL("/?jump=2%5E100%2B7");
    await expect(primeListPage.jumpInput).toHaveValue("2^100 + 7");
  });

  test("scientific notation: 1.5e3 is 1,500, written out in the URL since that's shorter", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await primeListPage.jumpTo("1.5e3");
    await expect(primeListPage.jumpFeedback).toHaveText("Jumped to 1,511 (first prime ≥ 1,500, 4 digits)");
    await expect(page).toHaveURL("/?jump=1500");

    await primeListPage.jumpTo("3e20");
    expect((await primeListPage.visiblePrimesExact())[0]).toBe(firstPrimeFrom(3n * 10n ** 20n));
    await expect(primeListPage.jumpFeedback).toContainText("21 digits");
    await expect(page).toHaveURL("/?jump=3e20");

    // a plain number, typed out: no digit count, as before
    await primeListPage.jumpTo("1,000");
    await expect(primeListPage.jumpFeedback).toHaveText("Jumped to 1,009 (first prime ≥ 1,000)");
  });

  test("a ?jump= link can be an expression, and a typed plus stays a plus", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open("/?jump=1e30");
    await expect(primeListPage.jumpFeedback).toContainText("31 digits", { timeout: 60_000 });
    await primeListPage.waitForWorkerToFinish();
    expect((await primeListPage.visiblePrimesExact())[0]).toBe(firstPrimeFrom(10n ** 30n));
    await expect(primeListPage.jumpInput).toHaveValue("1e30");

    // as typed in an address bar: read as 10^20 + 7, not 10^207
    await primeListPage.open("/?jump=10^20+7");
    await expect(primeListPage.jumpFeedback).toContainText("21 digits", { timeout: 60_000 });
    await primeListPage.waitForWorkerToFinish();
    expect((await primeListPage.visiblePrimesExact())[0]).toBe(firstPrimeFrom(10n ** 20n + 7n));
  });

  test("says why a fraction or a number too long for the browser can't be jumped to", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await primeListPage.jumpTo("1.25e1", { waitForLanding: false });
    await expect(primeListPage.jumpFeedback).toHaveText("Whole numbers only. Primes don’t do fractions.");
    await primeListPage.jumpTo("10^1000000000", { waitForLanding: false });
    await expect(primeListPage.jumpFeedback).toHaveText(
      "That has 1,000,000,001 digits: more than this browser can hold as one number.",
    );
    await primeListPage.jumpTo("2^2^3", { waitForLanding: false });
    await expect(primeListPage.jumpFeedback).toHaveText("That doesn’t look like a number. Try 1,000,003, 1e100 or 2^127 − 1.");
    expect((await primeListPage.topVisibleRow()).prime).toBe(2);
    await expect(page).toHaveURL("/");
  });

  test("at 320 px the jump line with a digit count stays within two lines and the page", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await primeListPage.jumpTo("10^60 + 8");
    await expect(primeListPage.jumpFeedback).toContainText("61 digits)");
    const { lines, overflow } = await primeListPage.jumpFeedback.evaluate((line) => ({
      lines: Math.round(line.getBoundingClientRect().height / parseFloat(getComputedStyle(line).lineHeight)),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(lines).toBeLessThanOrEqual(2);
    expect(overflow).toBe(0);
  });

  test("the prime checker reads them too, and puts the shorter form in ?n=", async ({ page }) => {
    await page.goto("/is-prime");
    const box = page.getByRole("textbox", { name: "Number" });
    await expect(box).toHaveAttribute("inputmode", "text");
    const check = page.getByRole("button", { name: "Check", exact: true });

    await box.fill("1e30");
    await check.click();
    await expect(page).toHaveURL(/\/is-prime\?n=1e30$/);
    await expect(page.getByTestId("prime-check-headline")).toContainText("isn’t prime: it’s even.");

    await box.fill("0^0");
    await check.click();
    await expect(page.getByTestId("prime-check-status")).toHaveText("0⁰ has no agreed value, so there’s nothing to check.");

    // a listed number, typed as an expression, opens its own page
    await box.fill("2^127 - 1");
    await check.click();
    await expect(page).toHaveURL(`/is-prime/${2n ** 127n - 1n}`);

    // and so does its ?n=, as an expression
    await page.goto("/is-prime?n=2%5E127-1");
    await expect(page).toHaveURL(`/is-prime/${2n ** 127n - 1n}`);
  });

  test("a form the browser sent before the script ran keeps its spaces as spaces", async ({ browser, page }) => {
    // form encoding writes spaces as “+”: 2^100 + 7 must not become 2^100+++7, nor 1 000 001 become 1 + 000 + 001
    const powerAddress = await nativelySubmitted(browser, "2^100 + 7");
    expect(powerAddress).toBe("/is-prime?number=2%5E100+%2B+7");
    await page.goto(powerAddress);
    await expect(page).toHaveURL("/is-prime?n=2%5E100%2B7");
    // as typed, or as the address has it once React's development mode reads it again
    await expect(page.getByRole("textbox", { name: "Number" })).toHaveValue(/^2\^100( \+ |\+)7$/);
    await expect(page.getByTestId("prime-check-headline")).toHaveText("1,267,650,600,…,703,205,383 isn’t prime: it’s divisible by 6,841.");

    await page.goto(await nativelySubmitted(browser, "1 000 001"));
    await expect(page).toHaveURL("/is-prime?n=1000001");
    await expect(page.getByTestId("prime-check-headline")).toHaveText("1,000,001 isn’t prime: it’s divisible by 101.");

    await page.goto(await nativelySubmitted(browser, "2^127 - 1"));
    await expect(page).toHaveURL(`/is-prime/${2n ** 127n - 1n}`);
  });

  test("so does a jump the browser sent before the script ran, and it becomes ?jump=", async ({ browser, page }) => {
    const address = await nativelySubmitted(browser, "2^100 + 7", "jump");
    expect(address).toBe("/?number=2%5E100+%2B+7");
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open(address);
    await expect(primeListPage.jumpFeedback).toContainText("31 digits", { timeout: 60_000 });
    await primeListPage.waitForWorkerToFinish();
    expect((await primeListPage.visiblePrimesExact())[0]).toBe(firstPrimeFrom(2n ** 100n + 7n));
    await expect(page).toHaveURL("/?jump=2%5E100%2B7");
    // as typed, or as the rewritten ?jump= has it once the box reads the address again
    await expect(primeListPage.jumpInput).toHaveValue(/^2\^100( \+ |\+)7$/);

    await primeListPage.open(await nativelySubmitted(browser, "1 000 001", "jump"));
    await expect(primeListPage.jumpFeedback).toHaveText("Jumped to 1,000,003 (first prime ≥ 1,000,001)", { timeout: 60_000 });
    await expect(page).toHaveURL("/?jump=1000001");
  });
});
