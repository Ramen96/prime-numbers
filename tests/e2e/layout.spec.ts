import { expect, test, type Page } from "@playwright/test";
import { PrimeListPage } from "./primeListPage";

const MIN_TAP_TARGET_PX = 44;

async function expectNoHorizontalScrolling(page: Page) {
  const { contentWidth, viewportWidth } = await page.evaluate(() => ({
    contentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(contentWidth).toBeLessThanOrEqual(viewportWidth);
}

test.describe("layout", () => {
  test("never scrolls horizontally, even with a long jump result", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await expectNoHorizontalScrolling(page);
    await primeListPage.jumpTo("1,000,000,000,000"); // long, 13-digit primes and labels
    await expectNoHorizontalScrolling(page);
  });

  test("Jump button and input are at least 44px tall", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    const jumpButton = page.getByRole("button", { name: "Jump" });
    for (const tapTarget of [primeListPage.jumpInput, jumpButton]) {
      const box = await tapTarget.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
    }
  });

  test("header pieces don't overlap", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    const pieces = [
      page.getByRole("heading", { name: "Every Prime Number" }),
      page.getByText("primes per second"),
      primeListPage.jumpInput,
      primeListPage.primeList,
    ];
    const boxes = await Promise.all(pieces.map((piece) => piece.boundingBox()));
    for (let first = 0; first < boxes.length; first++) {
      for (let second = first + 1; second < boxes.length; second++) {
        const boxA = boxes[first]!;
        const boxB = boxes[second]!;
        const overlaps =
          boxA.x < boxB.x + boxB.width &&
          boxB.x < boxA.x + boxA.width &&
          boxA.y < boxB.y + boxB.height &&
          boxB.y < boxA.y + boxA.height;
        expect(overlaps, `piece ${first} overlaps piece ${second}`).toBe(false);
      }
    }
  });
});

test.describe("layout on a 360px phone", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("never scrolls horizontally", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await expectNoHorizontalScrolling(page);
    await primeListPage.jumpTo("1,000,000,000,000"); // long, 13-digit primes and labels
    await expectNoHorizontalScrolling(page);
  });
});

test.describe("layout on a very wide monitor", () => {
  test.use({ viewport: { width: 2560, height: 1440 } });

  test("keeps the list at a comfortable width, and centres sidebar and page together", async ({
    page,
  }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    const listBox = (await primeListPage.primeList.boundingBox())!;
    expect(listBox.width).toBeLessThanOrEqual(44 * 16);

    const sidebarBox = (await page.getByTestId("site-nav").boundingBox())!;
    const pageContentBox = (await page.locator("main").boundingBox())!;
    const spaceLeft = sidebarBox.x;
    const spaceRight = 2560 - (pageContentBox.x + pageContentBox.width);
    expect(Math.abs(spaceLeft - spaceRight)).toBeLessThanOrEqual(1);
  });
});

test.describe("home page fits the screen", () => {
  test("the counter, jump form and list fit on one screen below the nav", async ({
    page,
  }, testInfo) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await expectNoHorizontalScrolling(page);

    // On phones the page scrolls past the intro; at the bottom, the panel
    // should fill exactly the screen below the sticky nav bar.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const viewportHeight = page.viewportSize()!.height;
    const navBox = (await page.getByTestId("site-nav").boundingBox())!;
    const counterBox = (await page.getByText("primes per second").boundingBox())!;
    const listBox = (await primeListPage.primeList.boundingBox())!;

    expect(listBox.y + listBox.height).toBeCloseTo(viewportHeight, 0);
    if (testInfo.project.name === "phone") {
      expect(counterBox.y).toBeGreaterThanOrEqual(navBox.y + navBox.height);
    } else {
      // Desktop: the page itself never scrolls.
      const pageScrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      expect(pageScrollHeight).toBeLessThanOrEqual(viewportHeight);
    }
  });
});

test("the counter shows a number shortly after load, without scrolling", async ({ page }) => {
  await page.goto("/");
  const counter = page.locator("header .font-mono").first();
  await expect(counter).toHaveText(/^\d{1,3}(,\d{3})+$/, { timeout: 5_000 });
  expect(await page.getByTestId("prime-list").evaluate((list) => list.scrollTop)).toBe(0);
});
