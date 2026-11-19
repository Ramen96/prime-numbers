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
  test("reads “Stop” until primes take minutes, then “Give up”, at the same width either way", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    const button = page.getByTestId("stop-button");
    // every test runs far faster than a prime a minute: the name is Stop's (an attribute
    // here, since the button stays hidden until a calculation is slow)
    await expect(button).toHaveAttribute("aria-label", "Stop calculating");
    // both labels are laid out in one cell and kept out of the accessible name
    const labels = button.locator("span");
    await expect(labels).toHaveText(["Stop", "Give up"]);
    for (const label of await labels.all()) await expect(label).toHaveAttribute("aria-hidden", "true");
    await expect(labels.nth(0)).not.toHaveClass(/\binvisible\b/);
    await expect(labels.nth(1)).toHaveClass(/\binvisible\b/);

    // what primesTakeMinutes switches (lib/heat.ts): which label is hidden. The button must not change size.
    const stopBox = await button.boundingBox();
    await labels.evaluateAll((spans) => spans.forEach((span) => span.classList.toggle("invisible")));
    expect(await button.boundingBox()).toEqual(stopBox);
  });

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
    await expect.poll(() => workers.length).toBe(1);
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

  test("while proving, Stop pauses instead of ending the worker, which goes on working afterwards", async ({ page }) => {
    // A batch past 10^100 takes about a minute, nearly all of it proving; sieving it takes well under a second.
    const workers = collectPrimeWorkers(page);
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await expect.poll(() => workers.length).toBe(1);
    let workerClosed = false;
    workers[0].once("close", () => (workerClosed = true));

    await primeListPage.jumpTo("1" + "0".repeat(100), { waitForLanding: false });
    const stopButton = page.getByRole("button", { name: "Stop calculating" });
    await expect(stopButton).toBeVisible();
    await expect(primeListPage.primeList.getByText(/^proving primality…/)).toBeVisible({ timeout: 20_000 });
    await stopButton.click();
    await expect(primeListPage.primeList).toHaveAttribute("data-status", "stopped");
    await page.waitForTimeout(500);
    expect(workerClosed, "the worker was paused, not terminated").toBe(false);

    // The same worker takes the next request.
    await primeListPage.jumpTo("1,000");
    expect((await primeListPage.topVisibleRow()).prime).toBe(1009);
    expect(workers.length).toBe(1);
    expect(workerClosed).toBe(false);
  });

  test("stopping while the worker's script loads isn't mistaken for a crash, and scrolling resumes", async ({ page }) => {
    // Terminating a worker part way through loading fails its import, which
    // reports an error a moment later. (By chunk name, so on the dev server.)
    await page.route("**/*primes_worker*", () => {}); // never answered
    await page.goto("/");
    const primeListPage = new PrimeListPage(page);
    const counter = page.locator("header .font-mono").first();
    const stopButton = page.getByRole("button", { name: "Stop calculating" });
    await expect(stopButton).toBeVisible();
    await stopButton.click();
    await expect(counter).toHaveText("stopped");
    await page.waitForTimeout(500); // the import's failure arrives after this
    await expect(counter).toHaveText("stopped");

    await page.unroute("**/*primes_worker*");
    await primeListPage.scrollByRows(400);
    await expect(counter).toHaveText(/^\d{1,3}(,\d{3})+$/);
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
