import { expect, test } from "@playwright/test";
import { PrimeListPage } from "./primeListPage";

// Far out, a row's position label (“≈ #7,291,408,…”) is as long as its prime, so
// it's shortened in the middle too (fitPrimeAndLabel in lib/shortenNumber.ts):
// under the prime on phones, beside it (at most 40% of the row when both are
// long) from 640px up. Screen readers get it whole, and a tap shows it in full
// under the prime. Kept near 10^60, like the other proving tests.

const NEAR_10_TO_THE_60 = `1${"0".repeat(60)}`;
const digitsOf = (text: string) => text.replace(/\D/g, "");

test("a long position label is shortened, stays inside its row, and opens in full", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const primeListPage = new PrimeListPage(page);
  await primeListPage.open(`/?jump=${NEAR_10_TO_THE_60}`);
  const rows = page.getByTestId("prime-row");
  await expect(rows.nth(3)).toBeVisible({ timeout: 60_000 });
  const list = (await page.getByTestId("prime-list").boundingBox())!;

  for (let index = 0; index < 3; index++) {
    const row = rows.nth(index);
    const label = row.getByTestId("prime-label");
    const shown = label.locator("[aria-hidden]");
    await expect(shown).toContainText("…");
    await expect(shown).toHaveText(/^≈ #[\d,]+,…,[\d,]+$/);
    // the whole position, for screen readers
    const whole = await label.locator(".sr-only").innerText();
    expect(digitsOf(whole).length).toBeGreaterThanOrEqual(58);
    // inside the list, and clear of the prime
    const labelBox = (await shown.boundingBox())!;
    expect(labelBox.x).toBeGreaterThanOrEqual(list.x);
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(list.x + list.width);
    const primeBox = (await row.locator("button").last().locator("span[aria-hidden]").last().boundingBox())!;
    if (testInfo.project.name === "desktop") {
      expect(labelBox.x + labelBox.width).toBeLessThan(primeBox.x); // beside: no overlap
      expect(primeBox.width).toBeGreaterThan(list.width * 0.4); // the prime keeps most of the row
    } else {
      expect(labelBox.y).toBeGreaterThanOrEqual(primeBox.y + primeBox.height - 1); // under it
    }
  }

  // a tap shows the prime and its whole position
  const row = rows.nth(1);
  const whole = await row.getByTestId("prime-label").locator(".sr-only").innerText();
  await row.locator("button").last().click();
  const position = page.getByTestId("popover-position");
  await expect(position).toBeVisible();
  expect(digitsOf(await position.innerText())).toBe(digitsOf(whole));
  await expect(position).toContainText("≈ #");
});
