import { expect, test, type Page } from "@playwright/test";
import { PrimeListPage, ROW_HEIGHT_PX } from "./primeListPage";

// Long primes are shortened in the middle at comma groups, and a tap shows
// them in full (lib/shortenNumber.ts, FittedNumber.tsx, NumberPopover.tsx).
// The sieve reaches about 20 digits, which fit whole at 320px and up, so
// these run at 280px: the cover screen of a Galaxy Z Fold, and narrow enough
// that primes near 2^64 are shortened. No test-only code in the app. At this
// width the page itself scrolls and the list shows only a few rows, so checks
// of every row read all rendered rows, not only the fully visible ones.

const NARROW_VIEWPORT = { width: 280, height: 740 };
const LARGEST_PRIME_BELOW_2_TO_THE_64 = "18,446,744,073,709,551,557";
const formatted = (prime: string) => BigInt(prime).toLocaleString("en-US");
const ELLIPSIS = "…";

test.use({ viewport: NARROW_VIEWPORT });

test.beforeEach(({}, testInfo) => {
  // The viewport is set here, so both projects would run the same test.
  test.skip(testInfo.project.name !== "phone", "one narrow viewport, run once");
});

async function openNearTwoToThe64(page: Page): Promise<PrimeListPage> {
  const primeListPage = new PrimeListPage(page);
  await primeListPage.open();
  await primeListPage.jumpTo(LARGEST_PRIME_BELOW_2_TO_THE_64);
  return primeListPage;
}

/** The first shortened prime on screen, as a button, with the prime it stands for. */
async function firstShortenedPrime(page: Page, primeListPage: PrimeListPage) {
  const [display] = (await primeListPage.visiblePrimeDisplays()).filter((row) => row.shortened);
  expect(display, "a shortened prime on screen").toBeDefined();
  const button = primeListPage.primeList
    .locator(`[data-testid="prime-row"][data-prime="${display.prime}"]`)
    .getByRole("button", { name: formatted(display.prime), exact: true });
  return { prime: display.prime, button };
}

test.describe("long primes in the list", () => {
  test("are shortened in the middle, keeping their first and last groups and the full number as their name", async ({
    page,
  }) => {
    const primeListPage = await openNearTwoToThe64(page);
    const displays = await primeListPage.visiblePrimeDisplays({ onlyFullyVisible: false });
    expect(displays.length).toBeGreaterThan(5);
    for (const display of displays) {
      const whole = formatted(display.prime);
      expect(display.shortened, `${whole} is shortened`).toBe(true);
      expect(display.accessibleName).toBe(whole);
      const [front, back] = display.shownText.split(ELLIPSIS);
      expect(display.shownText.split(ELLIPSIS), `${display.shownText}: one ellipsis`).toHaveLength(2);
      expect(front.endsWith(","), `${display.shownText}: cut at a comma`).toBe(true);
      expect(back.startsWith(","), `${display.shownText}: cut at a comma`).toBe(true);
      expect(whole.startsWith(front), `${display.shownText} starts like ${whole}`).toBe(true);
      expect(whole.endsWith(back), `${display.shownText} ends like ${whole}`).toBe(true);
      expect(front.length + back.length).toBeLessThan(whole.length);
    }
  });

  test("keep every row 44px tall, with nothing clipped or scrolling sideways", async ({ page }) => {
    const primeListPage = await openNearTwoToThe64(page);
    for (const display of await primeListPage.visiblePrimeDisplays({ onlyFullyVisible: false })) {
      expect(display.rowHeightPx).toBe(ROW_HEIGHT_PX);
    }
    const overflow = await primeListPage.primeList.evaluate((list) => ({
      list: { content: list.scrollWidth, visible: list.clientWidth },
      clippedPrimes: [...list.querySelectorAll<HTMLElement>('[data-testid="prime-row"] button[aria-haspopup] .font-mono')]
        .filter((shownPrime) => shownPrime.scrollWidth > shownPrime.clientWidth)
        .map((shownPrime) => shownPrime.textContent),
    }));
    expect(overflow.list.content).toBeLessThanOrEqual(overflow.list.visible);
    expect(overflow.clippedPrimes, "shortened primes cut off at the edge of their row").toEqual([]);
  });

  test("are tap targets 44px tall, reaching as much of their row as the star", async ({ page }) => {
    const primeListPage = await openNearTwoToThe64(page);
    await primeListPage.primeList.scrollIntoViewIfNeeded();
    // Probe every pixel down the middle of a shortened prime whose row is
    // fully inside the list, and of that row's star (the reference 44px
    // target), counting how much of the row reaches each.
    const tapTargets = await primeListPage.primeList.evaluate((list) => {
      const listBox = list.getBoundingClientRect();
      for (const primeButton of list.querySelectorAll<HTMLElement>('[data-testid="prime-row"] button[aria-haspopup]')) {
        const row = primeButton.closest<HTMLElement>('[data-testid="prime-row"]')!;
        const rowBox = row.getBoundingClientRect();
        if (rowBox.top < listBox.top || rowBox.bottom > listBox.bottom) continue;
        const starButton = row.querySelector<HTMLElement>("button[aria-pressed]")!;
        const rowHeightReaching = (button: HTMLElement) => {
          const buttonBox = button.getBoundingClientRect();
          const centerX = buttonBox.left + buttonBox.width / 2;
          let heightPx = 0;
          for (let y = Math.ceil(rowBox.top); y < rowBox.bottom; y++) {
            const hit = document.elementFromPoint(centerX, y);
            if (hit !== null && (hit === button || button.contains(hit))) heightPx++;
          }
          return heightPx;
        };
        return {
          prime: primeButton.getAttribute("aria-label"),
          primeButtonHeightPx: primeButton.getBoundingClientRect().height,
          primeReachesPx: rowHeightReaching(primeButton),
          starReachesPx: rowHeightReaching(starButton),
        };
      }
      return null;
    });
    expect(tapTargets, "a shortened prime whose row is inside the list").not.toBeNull();
    const { prime, primeButtonHeightPx, primeReachesPx, starReachesPx } = tapTargets!;
    expect(primeButtonHeightPx, `${prime}'s button height`).toBeGreaterThanOrEqual(44);
    expect(primeReachesPx, `px of ${prime}'s row that open it (the star reaches ${starReachesPx})`).toBeGreaterThanOrEqual(
      starReachesPx,
    );
  });

  test("are shown whole once there's room, and shortened again when there isn't", async ({ page }) => {
    const primeListPage = await openNearTwoToThe64(page);
    const shortenedPrimes = (await primeListPage.visiblePrimeDisplays()).map((display) => display.prime);

    await page.setViewportSize({ width: 360, height: NARROW_VIEWPORT.height });
    await expect
      .poll(async () => (await primeListPage.visiblePrimeDisplays()).every((display) => !display.shortened))
      .toBe(true);
    for (const display of await primeListPage.visiblePrimeDisplays()) {
      expect(display.shownText).toBe(formatted(display.prime));
    }
    // Still the same primes: resizing changes how they're shown, not which.
    const widePrimes = (await primeListPage.visiblePrimeDisplays()).map((display) => display.prime);
    expect(widePrimes.some((prime) => shortenedPrimes.includes(prime))).toBe(true);

    await page.setViewportSize(NARROW_VIEWPORT);
    await expect
      .poll(async () => (await primeListPage.visiblePrimeDisplays()).every((display) => display.shortened))
      .toBe(true);
  });
});

test.describe("the full-number popup", () => {
  test("opens on tap with every digit and the digit count, focus on Copy", async ({ page }) => {
    const primeListPage = await openNearTwoToThe64(page);
    const { prime, button } = await firstShortenedPrime(page, primeListPage);
    await button.click();

    const popup = page.getByRole("dialog");
    await expect(popup).toBeVisible();
    await expect(popup.getByRole("heading")).toHaveText(`${prime.length} digits`);
    await expect(popup.locator("p.font-mono")).toHaveText(formatted(prime));
    await expect(popup.getByRole("button", { name: "Copy" })).toBeFocused();
    // The whole number fits inside the popup: it wraps at commas, not off the edge.
    const popupOverflows = await popup.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(popupOverflows).toBe(false);
  });

  test("Copy puts just the digits on the clipboard, says so, then clears the message", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const primeListPage = await openNearTwoToThe64(page);
    const { prime, button } = await firstShortenedPrime(page, primeListPage);
    await button.click();

    const popup = page.getByRole("dialog");
    await popup.getByRole("button", { name: "Copy" }).click();
    const copyMessage = popup.getByRole("status");
    await expect(copyMessage).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prime);
    await expect(copyMessage).toHaveText("", { timeout: 4_000 });
  });

  test("says so when copying fails", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Clipboard.prototype, "writeText", {
        value: () => Promise.reject(new DOMException("Write permission denied.", "NotAllowedError")),
      });
    });
    const primeListPage = await openNearTwoToThe64(page);
    const { button } = await firstShortenedPrime(page, primeListPage);
    await button.click();

    const popup = page.getByRole("dialog");
    await popup.getByRole("button", { name: "Copy" }).click();
    await expect(popup.getByRole("status")).toHaveText("Couldn’t copy");
  });

  for (const closeWith of ["Escape", "the Close button"] as const) {
    test(`closes with ${closeWith} and gives focus back to the prime`, async ({ page }) => {
      const primeListPage = await openNearTwoToThe64(page);
      const { button } = await firstShortenedPrime(page, primeListPage);
      await button.click();
      const popup = page.getByRole("dialog");
      await expect(popup).toBeVisible();

      if (closeWith === "Escape") await page.keyboard.press("Escape");
      else await popup.getByRole("button", { name: "Close" }).click();
      await expect(popup).toBeHidden();
      await expect(button).toBeFocused();
    });
  }

  test("closes when clicking outside it, giving focus back to the prime", async ({ page }) => {
    const primeListPage = await openNearTwoToThe64(page);
    const { button } = await firstShortenedPrime(page, primeListPage);
    await button.click();
    const popup = page.getByRole("dialog");
    await expect(popup).toBeVisible();

    // Light dismiss doesn't restore focus by itself (Escape and Close do), so
    // this is the case NumberPopover's own focus handling is there for.
    await page.mouse.click(4, 4);
    await expect(popup).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("opens from the keyboard: Tab from a row's star to its prime, then Enter", async ({ page }) => {
    const primeListPage = await openNearTwoToThe64(page);
    const { prime, button } = await firstShortenedPrime(page, primeListPage);
    await primeListPage.primeList
      .locator(`[data-testid="prime-row"][data-prime="${prime}"]`)
      .getByRole("button", { name: `Favorite ${formatted(prime)}` })
      .focus();
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog").locator("p.font-mono")).toHaveText(formatted(prime));
  });

  test("opens again for the same prime after closing", async ({ page }) => {
    const primeListPage = await openNearTwoToThe64(page);
    const { button } = await firstShortenedPrime(page, primeListPage);
    const popup = page.getByRole("dialog");
    for (let opening = 0; opening < 2; opening++) {
      await button.click();
      await expect(popup, `opening ${opening + 1}`).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(popup).toBeHidden();
    }
  });
});
