import { expect, test, type Page } from "@playwright/test";
import { collectPrimeWorkers, PrimeListPage } from "./primeListPage";

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
    const setupMs = parseNumber(await statValue(page, "base primes")); // "set up in 64.10 ms"
    const lastSievingMs = parseNumber(await statValue(page, "last batch"));
    const counterRate = parseNumber(await page.locator("header .font-mono").first().innerText());
    expect(setupMs).toBeGreaterThan(lastSievingMs);

    // Counting the setup would give roughly 1,000 primes / (setup + 2 batches).
    const rateIfSetupWereCounted = 1000 / ((setupMs + 2 * lastSievingMs) / 1000);
    expect(counterRate).toBeGreaterThan(2 * rateIfSetupWereCounted);
  });
});

test.describe("base-prime memory", () => {
  test("is shown, and grows with a jump that needs more base primes", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    const memoryFormat = /^[\d,.]+ (KB|MB|GB) of base primes$/;
    await expect.poll(() => statValue(page, "memory")).toMatch(memoryFormat);
    const bytes = (text: string) => parseNumber(text) * { KB: 1e3, MB: 1e6, GB: 1e9 }[text.split(" ")[1] as "KB"];
    const beforeJump = bytes(await statValue(page, "memory"));
    expect(beforeJump).toBeLessThan(1e6); // the first few thousand primes need very few

    // near 9 × 10^15, base primes go up to about 9.5 × 10^7: about 5.5 million, a byte each
    await primeListPage.jumpTo("9,000,000,000,000,000");
    const afterJump = bytes(await statValue(page, "memory"));
    expect(afterJump).toBeGreaterThan(5e6);
    expect(afterJump).toBeLessThan(7e6); // reserved from an estimate, not doubled
  });

  test("a jump back from far away starts a fresh worker, giving the memory back", async ({ page }) => {
    const workers = collectPrimeWorkers(page);
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();

    // near 2^63, base primes go up to about 3 × 10^9: about 150 MB
    await primeListPage.jumpTo("9,223,372,036,854,775,808");
    expect(parseNumber(await statValue(page, "memory"))).toBeGreaterThan(140);
    expect(workers).toHaveLength(1);

    // a small jump needs far less: the big worker is replaced, not reused
    const bigWorkerClosed = new Promise<void>((resolve) => workers[0].once("close", () => resolve()));
    await primeListPage.jumpTo("1,000,000");
    await bigWorkerClosed;
    expect(workers).toHaveLength(2);
    expect(await statValue(page, "memory")).toMatch(/ KB of base primes$/);
    await expect(primeListPage.primeList.getByTestId("prime-row").first()).toBeVisible();

    // a jump that needs as much as the worker holds doesn't restart it
    await primeListPage.jumpTo("2,000,000");
    expect(workers).toHaveLength(2);
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
