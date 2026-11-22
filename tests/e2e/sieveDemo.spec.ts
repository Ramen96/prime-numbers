import { expect, test, type Locator, type Page } from "@playwright/test";

// The interactive sieve of Eratosthenes on /how-it-works (SieveDemo.tsx, lib/sieveDemo.ts).

const PRIMES_UP_TO_120 = [
  2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113,
];

async function openDemo(page: Page): Promise<Locator> {
  await page.goto("/how-it-works");
  const demo = page.getByTestId("sieve-demo");
  await demo.scrollIntoViewIfNeeded();
  return demo;
}

const cell = (demo: Locator, value: number) => demo.getByRole("listitem").nth(value - 1);
const valuesInState = (demo: Locator, state: string) =>
  // the visible number only (each cell also holds screen-reader text, like "4, crossed off by 2")
  demo
    .locator(`li[data-state="${state}"]`)
    .evaluateAll((cells) => cells.map((cell) => Number(cell.querySelector('[aria-hidden="true"]')?.textContent)));

test.describe("sieve demo", () => {
  test("steps through 2, 3, 5 and 7 to the 30 primes up to 120, and Reset starts over", async ({ page }) => {
    const demo = await openDemo(page);
    const next = demo.getByRole("button", { name: "Next step" });
    const reset = demo.getByRole("button", { name: "Reset" });
    const caption = demo.getByTestId("sieve-demo-caption");
    const primesList = demo.getByTestId("sieve-demo-primes");

    await expect(demo.getByRole("listitem")).toHaveCount(120);
    await expect(caption).toContainText("none crossed off yet");
    await expect(reset).toBeDisabled();
    await expect(primesList).toBeHidden();
    const height = (await demo.boundingBox())!.height;

    const crossedBy: Record<number, number> = {};
    for (const [index, prime] of [2, 3, 5, 7].entries()) {
      await next.click();
      await expect(caption).toContainText(`${prime} is the next number not crossed off, so it’s prime`);
      await expect(cell(demo, prime)).toHaveAttribute("data-state", "sieving-prime");
      // each number goes in its smallest prime factor's step
      for (const value of await valuesInState(demo, "crossed")) crossedBy[value] ??= prime;
      expect(Object.keys(crossedBy).length, `after ${prime}`).toBe([59, 78, 85, 89][index]);
      // stepping never moves the page below
      expect((await demo.boundingBox())!.height).toBe(height);
    }
    expect(crossedBy[49]).toBe(7);
    expect(crossedBy[12]).toBe(2);
    await expect(cell(demo, 91)).toHaveText(/91, crossed off by 7/);

    await next.click();
    await expect(caption).toHaveText("11² = 121 is past 120, so everything left is prime: 30 primes.");
    await expect(next).toBeDisabled();
    const primesShown = [...[2, 3, 5, 7], ...(await valuesInState(demo, "prime"))];
    expect(primesShown.sort((first, second) => first - second)).toEqual(PRIMES_UP_TO_120);
    await expect(primesList).toBeVisible();
    await expect(primesList).toHaveText(`The primes up to 120: ${PRIMES_UP_TO_120.join(", ")}.`);
    await expect(cell(demo, 1)).toHaveText(/1, not prime/);
    expect((await demo.boundingBox())!.height).toBe(height);

    await reset.click();
    await expect(caption).toContainText("none crossed off yet");
    expect(await valuesInState(demo, "crossed")).toEqual([]);
    await expect(primesList).toBeHidden();
  });

  test("Play steps on its own, Pause holds it, and it stops at the end", async ({ page }) => {
    test.setTimeout(60_000);
    const demo = await openDemo(page);
    const play = demo.getByRole("button", { name: "Play" });
    const caption = demo.getByTestId("sieve-demo-caption");

    await play.click();
    const pause = demo.getByRole("button", { name: "Pause" });
    await expect(pause).toHaveAttribute("aria-pressed", "true");
    await expect(caption).toContainText("2 is the next number"); // the first step comes at once
    await expect(caption).toContainText("3 is the next number", { timeout: 5_000 });

    await pause.click();
    await expect(play).toHaveAttribute("aria-pressed", "false");
    const pausedAt = await caption.textContent();
    await page.waitForTimeout(3_000);
    await expect(caption).toHaveText(pausedAt!);

    await play.click();
    await expect(caption).toContainText("everything left is prime", { timeout: 15_000 });
    await expect(demo.getByRole("button", { name: "Play" })).toBeDisabled();
  });

  test("the caption is announced politely, and the grid's numbers are read with their state", async ({ page }) => {
    const demo = await openDemo(page);
    await expect(demo.getByTestId("sieve-demo-caption")).toHaveAttribute("aria-live", "polite");
    await expect(demo.getByRole("list", { name: "The numbers from 1 to 120" })).toBeVisible();
    await demo.getByRole("button", { name: "Next step" }).click();
    await expect(cell(demo, 2)).toHaveText(/2, prime/);
    await expect(cell(demo, 4)).toHaveText(/4, crossed off by 2/);
    for (const button of await demo.getByRole("button").all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("under reduced motion, crossings appear at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const demo = await openDemo(page);
    await demo.getByRole("button", { name: "Next step" }).click();
    const animation = await cell(demo, 4).evaluate((element) => getComputedStyle(element, "::after").animationName);
    expect(animation).toBe("none");
  });

  test("fits a 320 px screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const demo = await openDemo(page);
    const pastTheEdge = await demo.evaluate((element) =>
      [element, ...element.querySelectorAll("*")].filter(
        (part) => part.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5,
      ).length,
    );
    expect(pastTheEdge).toBe(0);
  });
});
