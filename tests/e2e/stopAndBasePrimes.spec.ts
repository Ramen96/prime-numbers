import { expect, test, type Page, type Worker } from "@playwright/test";
import { PrimeListPage } from "./primeListPage";

function parseNumber(text: string): number {
  return Number(text.replace(/[^\d.]/g, ""));
}

async function statValue(page: Page, label: string): Promise<string> {
  return page.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]").innerText();
}

test.describe("building base primes", () => {
  test("a big jump shows “Building base primes…”, then a counter of sieving speed only", async ({
    page,
  }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();

    // Building takes tens of milliseconds, too brief to catch by polling, so
    // record whether the message was ever rendered.
    await page.evaluate(() => {
      const observer = new MutationObserver(() => {
        // textContent, not innerText: the label is uppercased with CSS.
        if (document.body.textContent?.includes("Building base primes…")) {
          (window as unknown as { sawBuildingBasePrimes: boolean }).sawBuildingBasePrimes = true;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });

    await primeListPage.jumpTo("9,000,000,000,000,000");
    expect(
      await page.evaluate(
        () => (window as unknown as { sawBuildingBasePrimes?: boolean }).sawBuildingBasePrimes,
      ),
    ).toBe(true);
    await expect(page.getByText("Building base primes…")).toBeHidden();

    // The jump timed one batch of base-prime building and two batches of sieving.
    const setupMs = parseNumber(await statValue(page, "base primes")); // "built in 64.10 ms"
    const lastSievingMs = parseNumber(await statValue(page, "last batch"));
    const counterRate = parseNumber(await page.locator("header .font-mono").first().innerText());
    expect(setupMs).toBeGreaterThan(lastSievingMs);

    // Counting the setup would give roughly 1,000 primes / (setup + 2 batches).
    const rateIfSetupWereCounted = 1000 / ((setupMs + 2 * lastSievingMs) / 1000);
    expect(counterRate).toBeGreaterThan(2 * rateIfSetupWereCounted);
  });
});

test.describe("Stop button", () => {
  test("stops the calculation, keeps the visible primes, and scrolling resumes", async ({
    page,
  }) => {
    // Hold back the WebAssembly module: the worker's first calculation (the
    // on-load fill) can't finish until it's released. A deterministic stand-in
    // for a long calculation, with no test-only code in the app.
    let releaseWasm: () => void = () => {};
    const wasmReleased = new Promise<void>((resolve) => (releaseWasm = resolve));
    await page.route("**/sieve.wasm", async (route) => {
      await wasmReleased;
      await route.continue().catch(() => {}); // the first worker is gone by then
    });

    const workers: Worker[] = [];
    page.on("worker", (worker) => workers.push(worker));

    await page.goto("/");
    const primeListPage = new PrimeListPage(page);
    const stopButton = page.getByRole("button", { name: "Stop calculating" });
    const counter = page.locator("header .font-mono").first();

    // Hidden at first, shown once the calculation has run for a moment.
    await expect(primeListPage.primeList.getByTestId("prime-row").first()).toBeVisible();
    await expect(stopButton).toBeVisible();
    expect(workers).toHaveLength(1);
    const primesBeforeStopping = await primeListPage.renderedPrimes();

    const firstWorkerClosed = new Promise<void>((resolve) => workers[0].once("close", () => resolve()));
    await stopButton.click();
    await firstWorkerClosed; // terminated, not just ignored

    await expect(counter).toHaveText("stopped");
    await expect(primeListPage.primeList).toHaveAttribute("data-status", "stopped");
    await expect(stopButton).toBeHidden();
    expect(await primeListPage.renderedPrimes()).toEqual(primesBeforeStopping);

    // Scrolling to the next fetch threshold starts a fresh worker.
    releaseWasm();
    await primeListPage.scrollByRows(400);
    await expect.poll(() => workers.length).toBe(2);
    await expect(counter).toHaveText(/^\d{1,3}(,\d{3})+$/);
    // The fresh worker added primes past the server's first batch (which ends at 3,571).
    await expect.poll(async () => parseNumber(await statValue(page, "frontier"))).toBeGreaterThan(3571);
  });

  test("is reachable from the keyboard and big enough to tap", async ({ page }) => {
    let releaseWasm: () => void = () => {};
    const wasmReleased = new Promise<void>((resolve) => (releaseWasm = resolve));
    await page.route("**/sieve.wasm", async (route) => {
      await wasmReleased;
      await route.continue().catch(() => {});
    });
    await page.goto("/");
    const stopButton = page.getByRole("button", { name: "Stop calculating" });
    await expect(stopButton).toBeVisible();

    const box = await stopButton.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await stopButton.focus();
    await expect(stopButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("header .font-mono").first()).toHaveText("stopped");
    releaseWasm();
  });
});
