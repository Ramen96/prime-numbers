import { expect, test } from "@playwright/test";
import { PrimeListPage } from "./primeListPage";

test.describe("shareable jump links", () => {
  test("/?jump=1000000000000 lands on 1,000,000,000,039", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open("/?jump=1000000000000");

    await expect(primeListPage.jumpFeedback).toContainText("Jumped to 1,000,000,000,039", {
      timeout: 60_000,
    });
    await primeListPage.waitForWorkerToFinish();
    expect((await primeListPage.topVisibleRow()).prime).toBe(1_000_000_000_039);
    await expect(primeListPage.jumpInput).toHaveValue("1000000000000");
  });

  test("jumping updates the URL, and jumping back to the start clears it", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    const historyLengthBefore = await page.evaluate(() => history.length);

    await primeListPage.jumpTo("1,000,000");
    await expect(page).toHaveURL("/?jump=1000000");
    await primeListPage.jumpTo("5,000");
    await expect(page).toHaveURL("/?jump=5000");
    await primeListPage.jumpTo("2");
    await expect(page).toHaveURL("/");

    // replaceState, not pushState: no history entry per jump.
    expect(await page.evaluate(() => history.length)).toBe(historyLengthBefore);
  });

  test("an invalid ?jump= shows the normal validation message", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open("/?jump=banana");
    await expect(primeListPage.jumpFeedback).toHaveText("That doesn't look like a number.");
    expect((await primeListPage.topVisibleRow()).prime).toBe(2);
  });

  test("the canonical URL stays / for jump links", async ({ request }) => {
    const html = await (await request.get("/?jump=1000000000000")).text();
    expect(html).toContain('<link rel="canonical" href="https://everyprimenumber.com"/>');
  });

  test("“see it live” links on /how-it-works open the list at that number", async ({ page }) => {
    await page.goto("/how-it-works");
    await page.getByRole("link", { name: "Try it: jump to a billion" }).click();
    await expect(page).toHaveURL("/?jump=1000000000");
    const primeListPage = new PrimeListPage(page);
    await expect(primeListPage.jumpFeedback).toContainText("Jumped to 1,000,000,007", {
      timeout: 60_000,
    });
  });
});
