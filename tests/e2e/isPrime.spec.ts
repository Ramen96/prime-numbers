import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { certificateFromJson } from "../../lib/certificateExport.ts";
import { checkCertificate } from "../../lib/primes/primalityCertificate.ts";
import { nextPrimeAfter } from "../support/primality";

// The prime checker, /is-prime (PrimeChecker.tsx, primeCheck.worker.ts): an
// answer with its evidence for any number, a proof on request, Give up, and the
// number in the address bar.

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

const headline = (page: Page) => page.getByTestId("prime-check-headline");
const status = (page: Page) => page.getByTestId("prime-check-status");

test.describe("is it prime?", () => {
  test("answers with its evidence, and puts the number in the address bar", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/is-prime");
    await checkNumber(page, "1,000,001");
    await expect(headline(page)).toHaveText("1,000,001 isn’t prime: it’s divisible by 101.");
    await expect(page.getByTestId("prime-check-result")).toContainText("1,000,001 = 101 × 9,901.");
    await expect(page).toHaveURL(/\/is-prime\?n=1000001$/);

    await checkNumber(page, "1000003");
    await expect(headline(page)).toHaveText("1,000,003 is prime.");
    await expect(page.getByTestId("prime-check-position")).toHaveText("It’s the 78,499th prime.");

    await checkNumber(page, String(2n ** 61n - 1n));
    await expect(page.getByTestId("prime-check-result")).toContainText("Proven by Miller–Rabin with the first 9 primes as bases");

    await checkNumber(page, "3317044064679887385961981"); // a(13): passes all 13 bases, fails Lucas
    await expect(headline(page)).toContainText("isn’t prime: it fails the strong Lucas test.");

    await checkNumber(page, "1");
    await expect(headline(page)).toHaveText("1 isn’t prime.");

    await checkNumber(page, "2.5");
    await expect(status(page)).toHaveText("Whole numbers only. Primes don’t do fractions.");

    // back and forward go through the checked numbers
    await page.goBack();
    await expect(headline(page)).toContainText("fails the strong Lucas test");
    await page.goBack();
    await expect(page.getByTestId("prime-check-result")).toContainText("Proven by Miller–Rabin");
    await page.goForward();
    await expect(headline(page)).toContainText("fails the strong Lucas test");
    expect(errors).toEqual([]);
  });

  test("a link with ?n= opens with its answer", async ({ page }) => {
    await page.goto("/is-prime?n=1,000,000");
    await expect(headline(page)).toHaveText("1,000,000 isn’t prime: it’s even.");
    await expect(page.getByRole("textbox", { name: "Number" })).toHaveValue("1,000,000");
  });

  test("proves a probable prime on request, with a certificate that checks", async ({ page }) => {
    const errors = collectErrors(page);
    const prime = nextPrimeAfter(10n ** 59n);
    await page.goto(`/is-prime?n=${prime}`);
    await expect(headline(page)).toContainText("is almost certainly prime.");
    await expect(page.getByTestId("prime-check-estimate")).toContainText("A proof of a 60-digit number takes under a second on a laptop");
    await expect(page.getByRole("button", { name: "Favorite" })).toHaveCount(0); // not until it's proven

    await page.getByRole("button", { name: "Prove it" }).click();
    await expect(headline(page)).toContainText("is prime.", { timeout: 60_000 });
    await expect(page.getByTestId("prime-check-result")).toContainText("Proven by the elliptic curve certificate below");
    await expect(page.getByTestId("prime-check-position")).toContainText("estimated with li(x), not counted.");
    await expect(page.getByRole("button", { name: "Prove it" })).toHaveCount(0);

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download as JSON" }).click()]);
    const { prime: certified, steps } = certificateFromJson(await readFile((await download.path())!, "utf8"));
    expect(certified).toBe(prime);
    expect(checkCertificate(prime, steps)).toEqual({ valid: true });
    await expect(page.getByRole("link", { name: "Check it yourself →" })).toHaveAttribute("href", "/random-prime#check-a-certificate");
    expect(errors).toEqual([]);
  });

  test("says a certificate can be checked again, and links to the checker", async ({ request }) => {
    const html = await (await request.get("/is-prime")).text();
    expect(html).toMatch(
      /A prime’s certificate can be downloaded and checked again, with the(<!-- -->)? <a href="\/random-prime#check-a-certificate">certificate checker<\/a> or a program of your own./,
    );
  });

  test("Give up pauses a proof, and Prove it carries on", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/is-prime?n=${nextPrimeAfter(10n ** 399n)}`);
    await page.getByRole("button", { name: "Prove it" }).click();
    await expect(status(page)).toContainText("proving primality", { timeout: 30_000 });
    await page.getByRole("button", { name: "Give up: stop checking this number" }).click();
    await expect(status(page)).toHaveText("Gave up on the proof. “Prove it” carries on where it stopped.");
    await expect(headline(page)).toContainText("is almost certainly prime."); // still shown

    await page.getByRole("button", { name: "Prove it" }).click();
    await expect(status(page)).toContainText("proving primality");
    // a new check pauses the proof and answers at once
    await checkNumber(page, "91");
    await expect(headline(page)).toHaveText("91 isn’t prime: it’s divisible by 7.");
  });

  test("Give up ends a long check, and the next check works", async ({ page }) => {
    test.setTimeout(60_000);
    // 1 more than a multiple of every prime below 65,536, so the C side gets it: BPSW at about 30,000 digits takes minutes
    let everySmallPrime = 1n;
    for (let prime = 2n; prime < 65_536n; prime = nextPrimeAfter(prime)) everySmallPrime *= prime;
    const slow = everySmallPrime * 10n ** 2_000n + 1n;
    await page.goto("/is-prime");
    await checkNumber(page, String(slow));
    await expect(status(page)).toHaveText(/^checking… \d+(\.\d)? s$/, { timeout: 10_000 }); // its time shows from a second in
    await page.getByRole("button", { name: "Give up: stop checking this number" }).click();
    await expect(status(page)).toHaveText("Gave up on that one.");
    await expect(page.getByTestId("prime-check-result")).toHaveCount(0);
    await checkNumber(page, "97");
    await expect(headline(page)).toHaveText("97 is prime.");
  });

  test("a proven prime can be favorited, copied, and found in the list", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/is-prime?n=1000003");
    const star = page.getByRole("button", { name: "Favorite 1,000,003" });
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Copy number" }).click();
    await expect(page.getByTestId("prime-check-copy-status")).toHaveText("Copied 1,000,003.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("1000003");
    await page.getByRole("link", { name: "Find it in the list" }).click();
    await expect(page).toHaveURL(/\/\?jump=1000003$/);
    await expect(page.locator('[data-testid="prime-row"][data-prime="1000003"]')).toBeVisible({ timeout: 15_000 });

    await page.goto("/favorites");
    await expect(page.locator("main")).toContainText("1,000,003");
  });

  test("is indexable, and linked from the home page (desktop), /how-it-works and /random-prime", async ({ page, request }, testInfo) => {
    const html = await (await request.get("/is-prime")).text();
    expect(html).toContain("<title>Is it prime? Check any number, with a proof | Every Prime Number</title>");
    expect(html).not.toContain("noindex");

    await page.goto("/");
    const homeLink = page.getByRole("link", { name: "Is your number prime? Check it, with a proof →" });
    if (testInfo.project.name === "desktop") {
      await homeLink.click();
      await expect(page).toHaveURL(/\/is-prime$/);
    } else {
      await expect(homeLink).toBeHidden(); // on phones every line there takes height from the list
    }
    for (const [path, name] of [
      ["/how-it-works", "Or check a number of your own: is it prime? →"],
      ["/random-prime", "Got a number of your own? Check whether it’s prime →"],
    ]) {
      await page.goto(path);
      await expect(page.getByRole("link", { name })).toHaveAttribute("href", "/is-prime");
    }
  });

  test("fits a 320 px screen, with 44 px buttons", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/is-prime?n=${nextPrimeAfter(10n ** 39n)}`);
    await page.getByRole("button", { name: "Prove it" }).click();
    await expect(headline(page)).toContainText("is prime.", { timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    for (const button of await page.getByTestId("prime-checker").getByRole("button").all())
      if (await button.isVisible()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});
