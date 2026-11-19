import { expect, test, type Page } from "@playwright/test";
import { PrimeListPage, ROW_HEIGHT_PX } from "./primeListPage";

// The meltdown (lib/heat.ts, Cpu.module.scss): past the top of heat, near 10^24, the
// CPU graphic melts as the rate keeps falling. Decorative: it must never move the layout.

const CPU_WIDTH_PX = 120;
const CPU_HEIGHT_PX = 150;

async function meltdownOnPage(page: Page): Promise<number> {
  return page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue("--meltdown")));
}

/** Where the CPU, the counter and the first row sit, to compare before and after. */
async function layoutOf(page: Page, primeListPage: PrimeListPage) {
  const box = async (locator: ReturnType<Page["locator"]>) => {
    const { x, y, width, height } = (await locator.boundingBox())!;
    return { x, y, width, height };
  };
  return {
    cpu: await box(page.getByTestId("cpu")),
    header: await box(page.locator("header").first()),
    firstRow: await box(primeListPage.primeList.getByTestId("prime-row").first()),
  };
}

test.describe("meltdown", () => {
  test("starts once heat is at its top, and sets solid again back at the start", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    expect(await meltdownOnPage(page)).toBe(0);

    await primeListPage.jumpTo("1" + "0".repeat(60));
    await expect.poll(() => meltdownOnPage(page)).toBeGreaterThan(0.1);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--heat")))
      .toBe("1");

    await primeListPage.jumpTo("2");
    await expect.poll(() => meltdownOnPage(page)).toBe(0);
  });

  test("never moves the layout: the CPU keeps its box, the counter and rows stay put", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    const setMeltdown = (value: number) =>
      page.evaluate((meltdown) => {
        document.documentElement.style.setProperty("--heat", "1");
        document.documentElement.style.setProperty("--meltdown", String(meltdown));
      }, value);

    await setMeltdown(0);
    const solid = await layoutOf(page, primeListPage);
    expect(solid.cpu.width).toBe(CPU_WIDTH_PX);
    expect(solid.cpu.height).toBe(CPU_HEIGHT_PX);
    expect(solid.firstRow.height).toBe(ROW_HEIGHT_PX);

    for (const value of [0.25, 0.5, 0.75, 1]) {
      await setMeltdown(value);
      expect(await layoutOf(page, primeListPage), `at meltdown ${value}`).toEqual(solid);
    }
    // every part of the graphic, puddle and smoke included, stays inside its box
    const outside = await page.getByTestId("cpu").evaluate((cpu) => {
      const frame = cpu.getBoundingClientRect();
      return [...cpu.querySelectorAll("*")]
        .map((part) => part.getBoundingClientRect())
        .filter((part) => part.width > 0 && (part.left < frame.left - 0.5 || part.right > frame.right + 0.5 ||
          part.top < frame.top - 0.5 || part.bottom > frame.bottom + 0.5)).length;
    });
    expect(outside).toBe(0);
  });
});
