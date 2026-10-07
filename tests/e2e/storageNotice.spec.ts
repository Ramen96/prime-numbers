import { expect, test, type Page } from "@playwright/test";
import { PrimeListPage } from "./primeListPage";

// These tests are about the first visit, so start without the "notice seen"
// flag that playwright.config.ts gives every other test.
test.use({ storageState: { cookies: [], origins: [] } });

const NOTICE_TEXT = "This site saves your favorite primes and scroll records in your browser";

function storageNotice(page: Page) {
  return page.getByRole("region", { name: "Storage notice" });
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  return errors;
}

test.describe("storage notice", () => {
  test("isn't in the server-rendered HTML", async ({ request }) => {
    const html = await (await request.get("/")).text();
    expect(html).not.toContain(NOTICE_TEXT);
  });

  test("shows on the first visit, and not after a reload, even without clicking OK", async ({ page }) => {
    await new PrimeListPage(page).open();
    await expect(storageNotice(page)).toBeVisible();
    await expect(storageNotice(page)).toContainText("Nothing is sent anywhere: no tracking, no analytics.");

    await page.reload();
    await expect(page.getByTestId("prime-list")).toBeVisible();
    await page.waitForTimeout(300); // the notice would appear right after mount
    await expect(storageNotice(page)).toBeHidden();
  });

  test("OK hides it straight away, and it stays hidden after a reload", async ({ page }) => {
    await new PrimeListPage(page).open();
    await storageNotice(page).getByRole("button", { name: "OK" }).click();
    await expect(storageNotice(page)).toBeHidden();

    await page.reload();
    await page.waitForTimeout(300);
    await expect(storageNotice(page)).toBeHidden();
  });

  test("with localStorage blocked, it shows, OK works, and nothing breaks", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      });
    });
    const errors = collectErrors(page);
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();

    await expect(storageNotice(page)).toBeVisible();
    await storageNotice(page).getByRole("button", { name: "OK" }).click();
    await expect(storageNotice(page)).toBeHidden();
    await primeListPage.jumpTo("1,000,000");
    expect((await primeListPage.topVisibleRow()).prime).toBe(1_000_003);
    expect(errors).toEqual([]);
  });

  test("is keyboard reachable with a 44px OK button", async ({ page }) => {
    await new PrimeListPage(page).open();
    const okButton = storageNotice(page).getByRole("button", { name: "OK" });
    const box = await okButton.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await okButton.focus();
    await page.keyboard.press("Enter");
    await expect(storageNotice(page)).toBeHidden();
  });

  test("“Learn more” leads to the FAQ answer, which says the same thing", async ({ page }) => {
    await new PrimeListPage(page).open();
    await storageNotice(page).getByRole("link", { name: "Learn more about what this site stores" }).click();
    await expect(page).toHaveURL("/about#is-any-of-my-data-sent-anywhere");
    const answer = page.locator("#is-any-of-my-data-sent-anywhere + p");
    await expect(answer).toContainText("saves your favorite primes and scroll records in your browser");
    await expect(answer).toContainText("never sent anywhere");
    await expect(answer).toContainText("no analytics");
  });

  test("covers nothing, and dismissing it doesn't move the visible primes", async ({ page }, testInfo) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await expect(storageNotice(page)).toBeVisible();
    // On phones the page scrolls past the intro; go to where the list fills the screen.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

    const noticeTop = (await storageNotice(page).boundingBox())!.y;
    const listBox = (await primeListPage.primeList.boundingBox())!;
    expect(listBox.y + listBox.height).toBeLessThanOrEqual(noticeTop + 0.5); // last rows aren't behind it
    for (const piece of [page.getByText("primes per second"), primeListPage.jumpInput]) {
      const box = (await piece.boundingBox())!;
      expect(box.y + box.height, `${testInfo.project.name}: ${piece}`).toBeLessThanOrEqual(noticeTop);
    }

    const rowsBefore = await primeListPage.visibleRows();
    await storageNotice(page).getByRole("button", { name: "OK" }).click();
    await expect(storageNotice(page)).toBeHidden();
    const rowsAfter = await primeListPage.visibleRows();
    for (const row of rowsBefore) {
      const sameRowAfter = rowsAfter.find((candidate) => candidate.prime === row.prime);
      expect(sameRowAfter?.topPx, `prime ${row.prime}`).toBe(row.topPx);
    }
    expect(rowsAfter.length).toBeGreaterThan(rowsBefore.length); // the list grew into the freed space
  });
});
