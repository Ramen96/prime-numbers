import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { certificateFromJson } from "../../lib/certificateExport.ts";
import { checkCertificate } from "../../lib/primes/primalityCertificate.ts";
import { DETERMINISTIC_BELOW, nextPrimeAfter } from "../support/primality";

// The random-prime page: a random prime with as many digits as asked, proven in
// the browser, with its certificate shown and downloadable.

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  return errors;
}

async function findRandomPrime(page: Page, digits: string, timeoutMs = 60_000) {
  const root = page.getByTestId("random-prime");
  await root.getByRole("textbox", { name: "Digits" }).fill(digits);
  await root.getByRole("button", { name: "Find a random prime" }).click();
  await expect(root.getByTestId("random-prime-result")).toBeVisible({ timeout: timeoutMs });
  return BigInt((await root.getByTestId("random-prime-value").innerText()).replace(/\D/g, ""));
}

/** Downloads the JSON certificate and checks it here, independently of the page. */
async function expectDownloadedCertificateProves(page: Page, prime: bigint) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download as JSON" }).click()]);
  expect(download.suggestedFilename()).toBe(`prime-${prime.toString().length}-digits-certificate.json`);
  const { prime: certifiedPrime, steps } = certificateFromJson(await readFile((await download.path())!, "utf8"));
  expect(certifiedPrime).toBe(prime);
  expect(steps[0].number).toBe(prime);
  for (let index = 0; index + 1 < steps.length; index++) expect(steps[index].orderPrime).toBe(steps[index + 1].number);
  expect(steps.at(-1)!.orderPrime < DETERMINISTIC_BELOW).toBe(true);
  expect(checkCertificate(prime, steps)).toEqual({ valid: true });
  return steps;
}

test.describe("random prime", () => {
  for (const digits of [30, 60]) {
    test(`finds a ${digits}-digit prime, proven, with a certificate that checks`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto("/random-prime");
      const prime = await findRandomPrime(page, String(digits));
      expect(prime.toString().length).toBe(digits);
      expect(nextPrimeAfter(prime - 1n)).toBe(prime); // prime, by the test reference

      const steps = await expectDownloadedCertificateProves(page, prime);
      const shownSteps = page.getByTestId("certificate-steps").getByRole("listitem");
      await expect(shownSteps).toHaveCount(steps.length);
      await expect(shownSteps.first()).toContainText(`Step 1 of ${steps.length}: N has ${digits} digits`);
      // a step opens to its numbers in full
      await shownSteps.first().locator("summary").click();
      await expect(shownSteps.first().locator("dd").first()).toHaveText(prime.toLocaleString("en-US"));

      const [textDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download as text" }).click()]);
      const text = await readFile((await textDownload.path())!, "utf8");
      expect(text).toContain(`${prime}\n`);
      expect(text).toContain(`Step ${steps.length} of ${steps.length}`);
      expect(errors).toEqual([]);
    });
  }

  test("Give up stops a long proof, and the next find works", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/random-prime");
    const root = page.getByTestId("random-prime");
    await root.getByRole("textbox", { name: "Digits" }).fill("400");
    await root.getByRole("button", { name: "Find a random prime" }).click();
    await expect(root.getByTestId("random-prime-status")).toContainText("proving primality", { timeout: 30_000 });
    await root.getByRole("button", { name: "Give up: stop finding this prime" }).click();
    await expect(root.getByTestId("random-prime-status")).toHaveText("Gave up on that one.");
    await expect(root.getByTestId("random-prime-result")).toBeHidden();
    const prime = await findRandomPrime(page, "30");
    expect(prime.toString().length).toBe(30);
  });

  test("asks for at least 26 digits, and a whole number of them", async ({ page }) => {
    await page.goto("/random-prime");
    const root = page.getByTestId("random-prime");
    const input = root.getByRole("textbox", { name: "Digits" });
    await input.fill("25");
    await root.getByRole("button", { name: "Find a random prime" }).click();
    await expect(root.getByTestId("random-prime-status")).toHaveText(
      "At least 26 digits: smaller primes are proven without a certificate to show.",
    );
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await input.fill("2.5");
    await root.getByRole("button", { name: "Find a random prime" }).click();
    await expect(root.getByTestId("random-prime-status")).toHaveText("A whole number of digits, like 100.");
  });

  test("fits a 320 px screen with a 100-digit prime and its certificate open", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/random-prime");
    await findRandomPrime(page, "100");
    await page.getByTestId("certificate-steps").locator("summary").first().click();
    const { content, viewport } = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(content).toBeLessThanOrEqual(viewport);
  });

  test("finds a 200-digit prime too @slow", async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto("/random-prime");
    const prime = await findRandomPrime(page, "200", 240_000);
    expect(prime.toString().length).toBe(200);
    await expectDownloadedCertificateProves(page, prime);
  });
});
