import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { PrimeListPage } from "./primeListPage";

// “Take me somewhere interesting” and the places on /fun-facts (lib/destinations.ts).

const MIN_TAP_TARGET_PX = 44;
const SURPRISE = "Take me somewhere interesting";

/** Makes the random pick predictable: every draw returns `value`, as the Mentat tests do. */
async function forceRandom(page: Page, value: number) {
  await page.addInitScript((draw) => {
    (window as unknown as { everyPrimeNumberDestinationRandom: () => number }).everyPrimeNumberDestinationRandom = () => draw;
  }, value);
}

/** The phone's compass in the jump box's row, or the desktop sidebar's text button. */
function surpriseButton(page: Page, testInfo: TestInfo) {
  return testInfo.project.name === "phone" ? page.getByTestId("surprise-icon-button") : page.getByRole("button", { name: SURPRISE }).last();
}

test.describe("Take me somewhere interesting", () => {
  test("jumps to a place from the pool, names it, and never picks the same place twice in a row", async ({ page }, testInfo) => {
    await forceRandom(page, 0.2); // the third of the pool: 1,000,003; then, with it left out, the third again: 8,675,309
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    const button = surpriseButton(page, testInfo);
    await expect(button).toBeVisible();
    await expect(button).toHaveAccessibleName(SURPRISE);

    await button.click();
    await expect(primeListPage.jumpFeedback).toHaveText("Jumped to 1,000,003: the first prime after a million.", { timeout: 30_000 });
    await expect(primeListPage.jumpInput).toHaveValue("1000003");
    await expect(page).toHaveURL(/\?jump=1000003$/);
    await primeListPage.waitForWorkerToFinish();
    expect((await primeListPage.topVisibleRow()).prime).toBe(1_000_003);

    await button.click();
    await expect(primeListPage.jumpFeedback).toHaveText("Jumped to 8,675,309: Jenny’s number, one of a pair of twin primes.", {
      timeout: 30_000,
    });
  });

  test("is a 44 px compass on phones and a text button on desktop", async ({ page }, testInfo) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    const icon = page.getByTestId("surprise-icon-button");
    const textButton = page.getByRole("button", { name: SURPRISE, exact: true }).filter({ hasText: SURPRISE });
    if (testInfo.project.name === "phone") {
      const box = (await icon.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
      expect(box.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
      await expect(textButton).toBeHidden();
      await expect(primeListPage.jumpInput).toHaveAttribute("placeholder", "Jump to…");
    } else {
      await expect(icon).toBeHidden();
      await expect(textButton).toBeVisible();
      expect((await textButton.boundingBox())!.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
      await expect(primeListPage.jumpInput).toHaveAttribute("placeholder", "Jump to… e.g. 15,000,000");
      await page.getByRole("link", { name: "All the places →" }).click();
      await expect(page).toHaveURL(/\/fun-facts#places-to-visit$/);
    }
  });

  test("a typed jump to a place names it too, even a hidden one", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await primeListPage.jumpTo("359");
    await expect(primeListPage.jumpFeedback).toHaveText("Jumped to 359: look closely.");
    await primeListPage.jumpTo("2,147,483,647");
    await expect(primeListPage.jumpFeedback).toHaveText("Jumped to 2,147,483,647: 2³¹ − 1, the largest signed 32-bit integer.");
    await primeListPage.jumpTo("1000");
    await expect(primeListPage.jumpFeedback).toHaveText("Jumped to 1,009 (first prime ≥ 1,000)"); // not a place: no name
  });

  test("fits a 320 px screen, the jump box and its name included", async ({ page }) => {
    await forceRandom(page, 0.2);
    await page.setViewportSize({ width: 320, height: 700 });
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await page.getByTestId("surprise-icon-button").click();
    await expect(primeListPage.jumpFeedback).toContainText("the first prime after a million", { timeout: 30_000 });
    const { contentWidth, viewportWidth } = await page.evaluate(() => ({
      contentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(contentWidth).toBeLessThanOrEqual(viewportWidth);
  });
});

test.describe("places to visit on /fun-facts", () => {
  test("lists every place but the hidden ones, marks the slow ones, and each link jumps there", async ({ page }) => {
    await page.goto("/fun-facts");
    const places = page.getByTestId("places-to-visit").getByRole("listitem");
    await expect(places).toHaveCount(14);
    await expect(places.filter({ hasText: "(slow: every prime there is proven one at a time)" })).toHaveCount(2);
    await expect(page.getByTestId("places-to-visit")).not.toContainText("314,159"); // the easter eggs stay hidden
    await expect(places.first()).toHaveText("1,000,003: The first prime after a million. Go there →");

    await places.filter({ hasText: "Ivan Pervushin" }).getByRole("link", { name: "Go there →" }).click();
    await expect(page).toHaveURL(/\/\?jump=2305843009213693951$/);
    await expect(new PrimeListPage(page).jumpFeedback).toHaveText(
      "Jumped to 2,305,843,009,213,693,951: 2⁶¹ − 1, a Mersenne prime from 1883.",
      { timeout: 30_000 },
    );
  });
});
