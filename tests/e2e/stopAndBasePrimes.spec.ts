import { expect, test, type Page } from "@playwright/test";
import { collectPrimeWorkers, PrimeListPage } from "./primeListPage";

function parseNumber(text: string): number {
  return Number(text.replace(/[^\d.]/g, ""));
}

async function statValue(page: Page, label: string): Promise<string> {
  return page.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]").innerText();
}

test.describe("measuring this device", () => {
  test("a far jump's measuring counts as setup, and the counter shows sieving speed only", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await primeListPage.jumpTo("9,000,000,000,000,000");

    // The jump measured where partial sieving starts (real batches, both ways)
    // and then sieved two batches.
    const setupMs = parseNumber(await statValue(page, "setup")); // "in 64.10 ms"
    const lastSievingMs = parseNumber(await statValue(page, "last batch"));
    const counterRate = parseNumber(await page.locator("header .font-mono").first().innerText());
    expect(setupMs).toBeGreaterThan(lastSievingMs);

    // Counting the setup would give roughly 1,000 primes / (setup + 2 batches).
    const rateIfSetupWereCounted = 1000 / ((setupMs + 2 * lastSievingMs) / 1000);
    expect(counterRate).toBeGreaterThan(2 * rateIfSetupWereCounted);
  });
});

test.describe("base-prime memory", () => {
  test("is shown, grows while measuring, and doesn't grow with a far jump", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    const memoryFormat = /^[\d,.]+ (KB|MB|GB) of base primes$/;
    await expect.poll(() => statValue(page, "memory")).toMatch(memoryFormat);
    const bytes = (text: string) => parseNumber(text) * { KB: 1e3, MB: 1e6, GB: 1e9 }[text.split(" ")[1] as "KB"];
    const beforeJump = bytes(await statValue(page, "memory"));
    expect(beforeJump).toBeLessThan(1e6); // the first few thousand primes need very few

    await primeListPage.jumpTo("9,000,000,000,000,000");
    const afterMeasuring = bytes(await statValue(page, "memory"));
    expect(afterMeasuring).toBeGreaterThan(beforeJump);

    // Sieving fully near 2^63 would take about 150 MB; past the switch nothing more is built.
    await primeListPage.jumpTo("9,223,372,036,854,775,808");
    expect(bytes(await statValue(page, "memory"))).toBe(afterMeasuring);
    expect(afterMeasuring).toBeLessThan(64e6);
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

    const workers = collectPrimeWorkers(page);

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
