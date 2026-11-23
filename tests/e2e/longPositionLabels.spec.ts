import { expect, test } from "@playwright/test";
import { PrimeListPage } from "./primeListPage";

// Far out, a row's position label (“≈ #7,291,408,…”) is as long as its prime, so
// it's shortened in the middle too (fitPrimeAndLabel in lib/shortenNumber.ts):
// under the prime on phones, beside it (at most 40% of the row when both are
// long) from 640px up. The row is a button named by what it shows (prime,
// label, digit count), and a tap shows both in full. Kept near 10^60, like the
// other proving tests.

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
    const shown = row.getByTestId("prime-label");
    await expect(shown).toHaveText(/^≈ #[\d,]+,…,[\d,]+$/);
    // estimated, but not dimmed: the “≈” says so, and dimming failed contrast in dark mode
    await expect(shown).toHaveCSS("opacity", "1");
    // named by what it shows (WCAG 2.5.3): prime, label, digit count
    const button = row.locator('button[aria-haspopup="dialog"]');
    const primeText = await button.locator(".font-mono").innerText();
    const digits = (await row.getAttribute("data-prime"))!.length;
    await expect(button).toHaveAccessibleName(`${primeText}, ${await shown.innerText()}, ${digits} digits`);
    // inside the list, and clear of the prime
    const labelBox = (await shown.boundingBox())!;
    expect(labelBox.x).toBeGreaterThanOrEqual(list.x);
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(list.x + list.width);
    const primeBox = (await button.locator(".font-mono").boundingBox())!;
    if (testInfo.project.name === "desktop") {
      expect(labelBox.x + labelBox.width).toBeLessThan(primeBox.x); // beside: no overlap
      expect(primeBox.width).toBeGreaterThan(list.width * 0.4); // the prime keeps most of the row
    } else {
      expect(labelBox.y).toBeGreaterThanOrEqual(primeBox.y + primeBox.height - 1); // under it
    }
  }

  // a tap shows the prime and its whole position, which the label's ends match
  const row = rows.nth(1);
  const [front, back] = (await row.getByTestId("prime-label").innerText()).replace("≈ #", "").split("…");
  await row.locator('button[aria-haspopup="dialog"]').click();
  const position = page.getByTestId("popover-position");
  await expect(position).toBeVisible();
  const whole = digitsOf(await position.innerText());
  expect(whole.length).toBeGreaterThanOrEqual(58);
  expect(whole.startsWith(digitsOf(front)) && whole.endsWith(digitsOf(back))).toBe(true);
  await expect(position).toContainText("≈ #");
});

test("the jump line shortens long numbers too, and stays on at most two lines", async ({ page }) => {
  test.setTimeout(90_000);
  const primeListPage = new PrimeListPage(page);
  await primeListPage.open(`/?jump=${NEAR_10_TO_THE_60}`);
  const line = primeListPage.jumpFeedback;
  await expect(line).toContainText("Jumped to", { timeout: 60_000 });
  // “Jumped to 1,000,000,…,000,007 (first prime ≥ 1,000,000,…,000,000)”
  await expect(line).toHaveText(/^Jumped to 1,000,[\d,]*…,[\d,]*\d{3} \(first prime ≥ 1,000,[\d,]*…,[\d,]*000\)$/);
  const { lines, overflow, lineRight, formRight } = await line.evaluate((element) => ({
    lines: Math.round(element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight)),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    lineRight: Math.max(...[...element.querySelectorAll("*")].map((child) => child.getBoundingClientRect().right)),
    formRight: element.closest("form")!.getBoundingClientRect().right,
  }));
  expect(lines).toBeLessThanOrEqual(2);
  expect(overflow).toBe(0);
  expect(lineRight).toBeLessThanOrEqual(formRight);
});
