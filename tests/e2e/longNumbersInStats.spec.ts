import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrimeListPage } from "./primeListPage";

// The stats under the counter show numbers that can have any number of digits
// (Requirement B), shortened in the middle when they don't fit their column
// (FittedNumber.tsx). Records are seeded far past what the sieve can reach,
// so this runs at both sizes, through the same path a stored record takes.

const STORAGE_KEY = "everyPrimeNumber.personalData";
const SIXTY_DIGIT_RECORD = "1" + "234567890".repeat(6) + "12345"; // 1 + 54 + 5 digits
const THOUSAND_DIGIT_RECORD = "9" + "0123456789".repeat(99) + "876543217"; // 1 + 990 + 9 digits
const ELLIPSIS = "…";
const formatted = (digits: string) => BigInt(digits).toLocaleString("en-US");

/** Seeds the records before the app's first load. */
async function seedRecords(page: Page, records: { furthestScroll: string | null; biggestPrimeVisited: string | null }) {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify({ version: 1, favorites: [], records })],
  );
}

/** A stat's value, by the label in front of it. */
function statValue(page: Page, label: string): Locator {
  return page.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]");
}

test.describe("long numbers in the stats", () => {
  test("are shortened in the middle, with the full number as their name and nothing overflowing", async ({ page }) => {
    expect(SIXTY_DIGIT_RECORD).toHaveLength(60);
    expect(THOUSAND_DIGIT_RECORD).toHaveLength(1000);
    await seedRecords(page, { furthestScroll: SIXTY_DIGIT_RECORD, biggestPrimeVisited: THOUSAND_DIGIT_RECORD });
    await new PrimeListPage(page).open();

    for (const [label, record] of [
      ["furthest scroll", SIXTY_DIGIT_RECORD],
      ["biggest visited", THOUSAND_DIGIT_RECORD],
    ] as const) {
      const whole = formatted(record);
      const button = statValue(page, label).getByRole("button", { name: whole, exact: true });
      await expect(button, `${label} is a button named with the whole number`).toBeVisible();
      await expect(button).toHaveAttribute("aria-haspopup", "dialog");

      const shownText = await button.innerText();
      const [front, back] = shownText.split(ELLIPSIS);
      expect(shownText.split(ELLIPSIS), `${label}: one ellipsis in ${shownText}`).toHaveLength(2);
      expect(front.endsWith(",") && back.startsWith(","), `${label}: cut at commas`).toBe(true);
      expect(whole.startsWith(front) && whole.endsWith(back), `${label}: ${shownText} is ${whole}'s ends`).toBe(true);
      const clipped = await button.evaluate((element) => element.scrollWidth > element.clientWidth);
      expect(clipped, `${label} is clipped`).toBe(false);
    }
    const pageOverflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(pageOverflows, "the page scrolls sideways").toBe(false);
  });

  test("open the popup with all 1,000 digits, wrapped only after commas, scrolling inside it, and Copy copies them all", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await seedRecords(page, { furthestScroll: null, biggestPrimeVisited: THOUSAND_DIGIT_RECORD });
    await new PrimeListPage(page).open();
    await statValue(page, "biggest visited").getByRole("button").click();

    const popup = page.getByRole("dialog");
    await expect(popup.getByRole("heading")).toHaveText("1,000 digits");
    const fullNumber = popup.locator("p.font-mono");
    await expect(fullNumber).toHaveText(formatted(THOUSAND_DIGIT_RECORD));

    const layout = await fullNumber.evaluate((paragraph) => {
      const lineHeightPx = parseFloat(getComputedStyle(paragraph).lineHeight);
      // Each digit group is its own text node (WrappableNumber.tsx); one that
      // wraps inside itself has more than one box.
      const splitGroups = [...paragraph.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE && /\d/.test(node.textContent ?? ""))
        .filter((node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return range.getClientRects().length > 1;
        })
        .map((node) => node.textContent);
      return { lines: Math.round(paragraph.getBoundingClientRect().height / lineHeightPx), splitGroups };
    });
    expect(layout.lines, "the number wraps onto several lines").toBeGreaterThan(1);
    expect(layout.splitGroups, "digit groups split across lines").toEqual([]);
    const popupOverflows = await popup.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(popupOverflows, "the popup scrolls sideways").toBe(false);

    // Never taller than the screen: the number scrolls inside, the rest stays in view.
    const popupBox = (await popup.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(popupBox.y, "the popup's top is on screen").toBeGreaterThanOrEqual(0);
    expect(popupBox.y + popupBox.height, "the popup's bottom is on screen").toBeLessThanOrEqual(viewport.height);
    for (const part of [
      popup.getByRole("heading"),
      popup.getByRole("button", { name: "Copy" }),
      popup.getByRole("button", { name: "Close" }),
    ]) {
      await expect(part).toBeInViewport({ ratio: 1 });
    }
    // Scrolled to the end, the number moves and its last group shows inside its
    // own box (rather than spilling out over the buttons below it).
    const scrolledToEnd = await fullNumber.evaluate((paragraph) => {
      paragraph.scrollTop = paragraph.scrollHeight;
      const lastGroup = document.createRange();
      lastGroup.selectNodeContents(paragraph.lastChild!);
      const lastGroupBox = lastGroup.getBoundingClientRect();
      const paragraphBox = paragraph.getBoundingClientRect();
      return {
        moved: paragraph.scrollTop > 0,
        lastGroupInside: lastGroupBox.top >= paragraphBox.top && lastGroupBox.bottom <= paragraphBox.bottom + 0.5,
      };
    });
    expect(scrolledToEnd.moved, "the number scrolls inside the popup").toBe(true);
    expect(scrolledToEnd.lastGroupInside, "the end of the number shows inside its box").toBe(true);

    await popup.getByRole("button", { name: "Copy" }).click();
    await expect(popup.getByRole("status")).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(THOUSAND_DIGIT_RECORD);
  });

  test("a record that fits stays plain text, with no button", async ({ page }) => {
    // Three groups, so it could be shortened (fewer never are) if it didn't fit.
    await seedRecords(page, { furthestScroll: "1000003", biggestPrimeVisited: "1000003" });
    await new PrimeListPage(page).open();
    const furthestScroll = statValue(page, "furthest scroll");
    await expect(furthestScroll).toHaveText("1,000,003");
    await expect(furthestScroll.getByRole("button")).toHaveCount(0);
  });
});
