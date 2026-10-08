import { expect, test, type Page, type Route, type Worker } from "@playwright/test";
import { nextPrimeAfter } from "../support/primality";
import { collectPrimeWorkers, collectSieveThreads, PrimeListPage } from "./primeListPage";

async function statValue(page: Page, label: string): Promise<string> {
  return page.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]").innerText();
}

const workerClosed = (worker: Worker) => new Promise<void>((resolve) => worker.once("close", () => resolve()));

/** Where Emscripten's loader starts each sieve thread (public/sieve-threads/sieve.mjs). */
const THREAD_START = 'new Worker(new URL("sieve.mjs",import.meta.url),';

/**
 * Serves the threaded build's loader with `replacement` for the line that
 * starts each thread: a way to make thread start-up fail the ways browsers
 * can, with no test-only code in the app.
 */
async function serveLoaderStartingThreadsWith(page: Page, replacement: string) {
  await page.route("**/sieve-threads/sieve.mjs", async (route: Route) => {
    const response = await route.fetch();
    const loader = await response.text();
    expect(loader).toContain(THREAD_START);
    await route.fulfill({ response, body: loader.replace(THREAD_START, replacement) });
  });
}

/** After a fallback: one thread, no error, and the list still right past 2^53. */
async function expectSingleThreadedListToWork(page: Page) {
  const primeListPage = new PrimeListPage(page);
  await primeListPage.open();
  await expect.poll(() => statValue(page, "threads")).toBe("1");
  await primeListPage.jumpTo("9,007,199,254,740,000");
  await primeListPage.scrollByRows(600);
  const primes = await primeListPage.visiblePrimesExact();
  expect(primes[0]).toBeGreaterThan(2n ** 53n);
  for (let index = 1; index < primes.length; index++) {
    expect(primes[index]).toBe(nextPrimeAfter(primes[index - 1]));
  }
  await expect(page.getByText("Stopped.")).toHaveCount(0);
  await expect(primeListPage.primeList).not.toHaveAttribute("data-status", "error");
}

test.describe("sieve threads", () => {
  test("sieve on one fewer thread than the device has cores", async ({ page }) => {
    const threads = collectSieveThreads(page);
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    const cores = await page.evaluate(() => navigator.hardwareConcurrency);
    await expect.poll(() => statValue(page, "threads")).toBe(String(Math.max(1, cores - 1)));
    // the prime worker sieves too, so it starts one thread fewer than that
    expect(threads).toHaveLength(Math.max(0, cores - 2));
  });

  test("fall back to one thread when nested workers can't start", async ({ page }) => {
    await serveLoaderStartingThreadsWith(page, "new (void 0)(new URL(\"sieve.mjs\",import.meta.url),");
    await expectSingleThreadedListToWork(page);
  });

  test("fall back to one thread when the threads' script fails to load", async ({ page }) => {
    await serveLoaderStartingThreadsWith(page, 'new Worker(new URL("missing-sieve-thread.mjs",import.meta.url),');
    await expectSingleThreadedListToWork(page);
  });

  test("all end when Stop is pressed, and the next calculation starts new ones", async ({ page }) => {
    const primeWorkers = collectPrimeWorkers(page);
    const threads = collectSieveThreads(page);
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    const threadsBefore = threads.length;
    expect(threadsBefore).toBeGreaterThan(0);

    // near 2^63, building base primes keeps every thread busy for a while
    await primeListPage.jumpTo("9,223,372,036,854,775,808", { waitForLanding: false });
    const stopButton = page.getByRole("button", { name: "Stop calculating" });
    await expect(stopButton).toBeVisible();
    const everythingClosed = Promise.all([...primeWorkers, ...threads].map(workerClosed));
    await stopButton.click();
    await everythingClosed; // terminated, every one, not just ignored

    await primeListPage.jumpTo("1,000,000");
    expect(primeWorkers).toHaveLength(2);
    expect(threads).toHaveLength(2 * threadsBefore);
  });

  test("all end when a jump arrives mid-calculation", async ({ page }) => {
    const threads = collectSieveThreads(page);
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    const firstThreads = [...threads];

    await primeListPage.jumpTo("9,223,372,036,854,775,808", { waitForLanding: false });
    await expect(page.getByRole("button", { name: "Stop calculating" })).toBeVisible();
    const firstThreadsClosed = Promise.all(firstThreads.map(workerClosed));
    await primeListPage.jumpTo("1,000,000");
    await firstThreadsClosed;
    await expect(primeListPage.primeList.getByTestId("prime-row").first()).toBeVisible();
  });

  test("leave scrolling smooth while every thread is busy near 2^63", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await primeListPage.jumpTo("9,223,372,036,854,775,808");

    // Record every frame, and when the worker is computing.
    await page.evaluate(() => {
      const recording = { frames: [] as number[], busy: [] as [number, string][] };
      (window as unknown as { recording: typeof recording }).recording = recording;
      const list = document.querySelector<HTMLElement>('[data-testid="prime-list"]')!;
      const onFrame = (time: number) => {
        recording.frames.push(time);
        requestAnimationFrame(onFrame);
      };
      requestAnimationFrame(onFrame);
      new MutationObserver(() => recording.busy.push([performance.now(), list.dataset.status ?? ""])).observe(list, {
        attributes: true,
        attributeFilter: ["data-status"],
      });
    });

    // Scroll down hard for a few seconds: fast enough that a batch near 2^63
    // (tens of ms on all threads) is needed every fraction of a second.
    // Real scroll gestures (touch on the phone, wheel on desktop), through the
    // browser's compositor as a user's would be, from the middle of the part
    // of the list that's on screen
    await primeListPage.primeList.scrollIntoViewIfNeeded(); // on a phone it starts below the header
    const box = (await primeListPage.primeList.boundingBox())!;
    const viewport = page.viewportSize()!;
    const visibleTop = Math.max(box.y, 0);
    const visibleBottom = Math.min(box.y + box.height, viewport.height);
    const devTools = await page.context().newCDPSession(page);
    const scrollUntil = Date.now() + 5000;
    while (Date.now() < scrollUntil) {
      await devTools.send("Input.synthesizeScrollGesture", {
        x: Math.round(box.x + box.width / 2),
        y: Math.round((visibleTop + visibleBottom) / 2),
        yDistance: -40_000, // negative: scroll down
        speed: 60_000, // px/s: a batch of 500 rows is 22,000 px
        gestureSourceType: "default",
      });
    }
    await primeListPage.waitForWorkerToFinish();

    const { frames, busy } = await page.evaluate(
      () => (window as unknown as { recording: { frames: number[]; busy: [number, string][] } }).recording,
    );
    // Every frame of the session counts, including the ones where a batch
    // arrives and the list updates (the main thread's busiest moments).
    // Separately, enough of them must fall while the worker was computing
    // (every thread busy), or the test didn't test what it says.
    const intervals: number[] = [];
    let framesWhileComputing = 0;
    let statusIndex = 0;
    let computing = false;
    for (let index = 1; index < frames.length; index++) {
      while (statusIndex < busy.length && busy[statusIndex][0] <= frames[index]) {
        computing = busy[statusIndex][1] === "computing" || busy[statusIndex][1] === "building-base-primes";
        statusIndex++;
      }
      intervals.push(frames[index] - frames[index - 1]);
      if (computing) framesWhileComputing++;
    }
    const batchesFetched = busy.filter(([, status]) => status === "computing").length;
    intervals.sort((a, b) => a - b);
    const percentile95 = intervals[Math.floor(intervals.length * 0.95)];
    const longest = intervals.at(-1)!;
    test.info().annotations.push({
      type: "frames",
      description: `${batchesFetched} batches, ${intervals.length} frames (${framesWhileComputing} while computing), p95 ${percentile95.toFixed(1)} ms, longest ${longest.toFixed(1)} ms`,
    });
    console.log(`frames (${test.info().project.name}): ${test.info().annotations.at(-1)?.description}`);
    expect(batchesFetched, "batches were fetched while scrolling").toBeGreaterThan(5);
    expect(framesWhileComputing, "frames were recorded while the threads were busy").toBeGreaterThan(20);
    // 60 frames a second is 16.7 ms a frame: p95 within two frames, nothing
    // close to a visible stall
    expect(percentile95).toBeLessThan(34);
    expect(longest).toBeLessThan(70);
  });
});
