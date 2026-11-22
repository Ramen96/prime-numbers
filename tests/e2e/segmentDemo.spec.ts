import { expect, test, type Locator, type Page } from "@playwright/test";

// The segmented sieve's window demo on /how-it-works (SegmentDemo.tsx, lib/segmentDemo.ts).

async function openDemo(page: Page): Promise<Locator> {
  await page.goto("/how-it-works");
  const demo = page.getByTestId("segment-demo");
  await demo.scrollIntoViewIfNeeded();
  return demo;
}

const cell = (demo: Locator, value: number) => demo.locator(`li[data-state]`).filter({ hasText: new RegExp(`^${value}`) }).first();
/** The window's numbers in a state: the visible number only (each cell also holds screen-reader text). */
const valuesInState = (demo: Locator, state: string) =>
  demo
    .locator(`li[data-state="${state}"]`)
    .evaluateAll((cells) => cells.map((cell) => Number(cell.querySelector('span[aria-hidden="true"]')?.textContent)));
const basePrimes = async (demo: Locator) =>
  (await demo.getByTestId("segment-demo-base-primes").locator("li:not([aria-hidden])").allInnerTexts()).map(Number);

test.describe("segment demo", () => {
  test("the first window is the worked example: 2, 3, 5 and 7 leave 101, 103, 107, 109 and 113", async ({ page }) => {
    const demo = await openDemo(page);
    const next = demo.getByRole("button", { name: "Next step" });
    const caption = demo.getByTestId("segment-demo-caption");
    await expect(demo.locator("li[data-state]")).toHaveCount(20);
    expect(await basePrimes(demo)).toEqual([2, 3, 5, 7]);
    await expect(caption).toContainText("The numbers 100 to 119. √119 is just under 11");
    const height = (await demo.boundingBox())!.height;

    await next.click();
    expect(await valuesInState(demo, "crossed")).toEqual([100, 102, 104, 106, 108, 110, 112, 114, 116, 118]);
    await next.click();
    await expect(caption).toContainText("3: 100 mod 3 is 1, so its first multiple here is 102.");
    await expect(demo.getByTestId("segment-demo-base-primes").locator('[aria-current="step"]')).toHaveText("3");
    // 102 is struck again: the sieve doesn't check
    await expect(cell(demo, 102)).toHaveAttribute("data-crossed-by", "2 3");
    await next.click();
    await next.click();
    await expect(cell(demo, 105)).toHaveAttribute("data-crossed-by", "3 5 7");
    await expect(cell(demo, 105)).toContainText("105, crossed off by 3, 5 and 7");
    await expect(cell(demo, 105).locator("span[aria-hidden]:not(:first-child)")).toHaveCount(3);

    await next.click();
    await expect(caption).toHaveText("What’s left is prime: 101, 103, 107, 109 and 113.");
    expect(await valuesInState(demo, "prime")).toEqual([101, 103, 107, 109, 113]);
    await expect(next).toBeDisabled();
    expect((await demo.boundingBox())!.height).toBe(height);
  });

  test("Next window moves along 20 numbers, and 11 joins the base primes at 121", async ({ page }) => {
    const demo = await openDemo(page);
    await demo.getByRole("button", { name: "Next window" }).click();
    await expect(demo.getByRole("list", { name: "The numbers from 120 to 139" })).toBeVisible();
    expect(await basePrimes(demo)).toEqual([2, 3, 5, 7, 11]);
    await expect(demo.getByTestId("segment-demo-caption")).toContainText("11² = 121 is inside it, so 11 joins the base primes");
    for (let step = 0; step < 6; step++) await demo.getByRole("button", { name: "Next step" }).click();
    expect(await valuesInState(demo, "prime")).toEqual([127, 131, 137, 139]);
    await expect(cell(demo, 121)).toHaveAttribute("data-crossed-by", "11");

    await demo.getByRole("button", { name: "Reset" }).click();
    await expect(demo.getByRole("list", { name: "The numbers from 100 to 119" })).toBeVisible();
    expect(await valuesInState(demo, "crossed")).toEqual([]);
    await expect(demo.getByRole("button", { name: "Reset" })).toBeDisabled();
  });

  test("Play steps on its own, Pause holds it, and it stops at the end of the window", async ({ page }) => {
    test.setTimeout(60_000);
    const demo = await openDemo(page);
    const caption = demo.getByTestId("segment-demo-caption");
    await demo.getByRole("button", { name: "Play" }).click();
    const pause = demo.getByRole("button", { name: "Pause" });
    await expect(pause).toHaveAttribute("aria-pressed", "true");
    await expect(caption).toContainText("2: 100 mod 2 is 0");
    await expect(caption).toContainText("3: 100 mod 3 is 1", { timeout: 5_000 });
    await pause.click();
    const pausedAt = await caption.textContent();
    await page.waitForTimeout(3_000);
    await expect(caption).toHaveText(pausedAt!);
    await demo.getByRole("button", { name: "Play" }).click();
    await expect(caption).toContainText("What’s left is prime", { timeout: 15_000 });
    await expect(demo.getByRole("button", { name: "Play" })).toBeDisabled();
  });

  test("is read with its state, has 44 px buttons, and draws no strikes under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const demo = await openDemo(page);
    await expect(demo.getByTestId("segment-demo-caption")).toHaveAttribute("aria-live", "polite");
    await expect(demo.getByRole("list", { name: "Base primes" })).toBeVisible();
    for (const button of await demo.getByRole("button").all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await demo.getByRole("button", { name: "Next step" }).click();
    await expect(cell(demo, 100)).toContainText("100, crossed off by 2");
    const animation = await cell(demo, 100)
      .locator("span[aria-hidden]:not(:first-child)")
      .first()
      .evaluate((strike) => getComputedStyle(strike).animationName);
    expect(animation).toBe("none");
  });

  test("fits a 320 px screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const demo = await openDemo(page);
    const pastTheEdge = await demo.evaluate((element) =>
      [element, ...element.querySelectorAll("*")].filter((part) => part.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5).length,
    );
    expect(pastTheEdge).toBe(0);
  });
});
