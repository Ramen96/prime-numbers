import { expect, test } from "./hardwareGpuStandIn";
import { nextPrimeAfter } from "../support/primality";
import {
  collectErrors,
  expectConsecutivePrimes,
  expectDownloadedCertificateProves,
  expectStrippedOnTheGpu,
  watchStripping,
} from "./gpuStrippingPage";
import { PrimeListPage } from "./primeListPage";

// GPU stripping (step 11d) in the browser. The "webgpu" project runs Chromium
// with --enable-unsafe-webgpu, which gives headless Chromium a software GPU
// (SwiftShader): slow, but the same WGSL and the same path through the GPU
// worker, so these check that the GPU's answers lead to correct primes and
// certificates. Speed is only measured headed, on a real GPU. The site refuses
// a software adapter (step 11f), so here SwiftShader is made to say it's hardware
// (hardwareGpuStandIn.ts, from outside the app); gpuSoftwareOnly.spec.ts checks it
// refused as it is. Only the "webgpu" project runs these (playwright.config.ts);
// the phone and desktop projects, with no adapter, run gpuUnavailable.spec.ts.
//
// What the workers report is read from their `stripping` messages, which reach
// the page (it doesn't show them yet: that's step 11e).

test.describe("GPU stripping, on a software GPU", () => {
  test("this browser has a WebGPU adapter, made to say it's hardware", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate(async () => (await navigator.gpu?.requestAdapter())?.info.architecture)).toBe("stand-in-hardware");
    await expect(page.getByTestId("gpu-switch")).toBeEnabled();
  });

  test("the list right after a jump to 10^79 (80 digits): stripped on the GPU, every prime proven, none skipped", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    const states = await watchStripping(page);
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    const target = 10n ** 79n;
    await primeListPage.jumpInput.fill(String(target));
    await primeListPage.jumpInput.press("Enter");
    await expect(primeListPage.jumpFeedback).toContainText("Jumped to", { timeout: 90_000 });
    await expect(primeListPage.primeList).toHaveAttribute("data-status", /^(idle|stopped|overflow|error)$/, { timeout: 90_000 });
    await expect(primeListPage.primeList).not.toHaveAttribute("data-status", "error");
    const primes = await primeListPage.visiblePrimesExact();
    expect(primes[0]).toBe(nextPrimeAfter(target - 1n));
    expectConsecutivePrimes(primes);
    expectStrippedOnTheGpu(await states());
    expect(errors).toEqual([]);
  });

  test("/is-prime: a 140-digit proof is stripped on the GPU and its certificate checks", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    const states = await watchStripping(page);
    const prime = nextPrimeAfter(10n ** 139n);
    await page.goto(`/is-prime?n=${prime}`);
    await page.getByRole("button", { name: "Prove it" }).click();
    await expect(page.getByTestId("prime-check-headline")).toContainText("is prime.", { timeout: 90_000 });
    await expectDownloadedCertificateProves(page, prime);
    expectStrippedOnTheGpu(await states());
    expect(errors).toEqual([]);
  });

  test("/is-prime: a lone proof below 135 digits stays on the CPU", async ({ page }) => {
    const errors = collectErrors(page);
    const states = await watchStripping(page);
    const prime = nextPrimeAfter(10n ** 99n);
    await page.goto(`/is-prime?n=${prime}`);
    await page.getByRole("button", { name: "Prove it" }).click();
    await expect(page.getByTestId("prime-check-headline")).toContainText("is prime.", { timeout: 60_000 });
    await expectDownloadedCertificateProves(page, prime);
    expect(await states()).toEqual(["cpu"]);
    expect(errors).toEqual([]);
  });

  test("/random-prime: a 140-digit prime is stripped on the GPU and its certificate checks", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    const states = await watchStripping(page);
    await page.goto("/random-prime");
    const root = page.getByTestId("random-prime");
    await root.getByRole("textbox", { name: "Digits" }).fill("140");
    await root.getByRole("button", { name: "Find a random prime" }).click();
    await expect(root.getByTestId("random-prime-result")).toBeVisible({ timeout: 90_000 });
    const prime = BigInt((await root.getByTestId("random-prime-value").innerText()).replace(/\D/g, ""));
    expect(prime.toString()).toHaveLength(140);
    await expectDownloadedCertificateProves(page, prime);
    expectStrippedOnTheGpu(await states());
    expect(errors).toEqual([]);
  });

  test("the switch: on by default, helping once proofs reach 75 digits, and off at once, remembered", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    const states = await watchStripping(page, null, { markBatches: true });
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    const gpuSwitch = page.getByRole("switch", { name: "Use the GPU for proofs" });
    const rowText = page.getByTestId("gpu-row-text");
    await expect(gpuSwitch).toHaveAttribute("aria-checked", "true");
    await expect(gpuSwitch).toBeEnabled();
    await expect(rowText).toHaveText("on, used from 75 digits");
    expect(await page.evaluate(() => localStorage.getItem("everyPrimeNumber.gpu"))).toBeNull(); // the default, not a stored choice

    await primeListPage.jumpInput.fill(String(10n ** 79n));
    await primeListPage.jumpInput.press("Enter");
    await expect(rowText).toHaveText("on, helping", { timeout: 90_000 });
    const batchesBefore = (await states()).filter((state) => state === "batch").length;
    await gpuSwitch.click(); // while the batch is still being proven
    await expect(gpuSwitch).toHaveAttribute("aria-checked", "false");
    await expect(rowText).toHaveText("off, CPU only");
    expect(await page.evaluate(() => localStorage.getItem("everyPrimeNumber.gpu"))).toBe("off");
    await expect(primeListPage.primeList).toHaveAttribute("data-status", /^(idle|stopped|overflow)$/, { timeout: 90_000 });
    const primes = await primeListPage.visiblePrimesExact();
    expectConsecutivePrimes(primes);
    // the worker went back to the CPU before that batch ended, not at the next one
    const seen = await states();
    const switchedAt = seen.lastIndexOf("cpu");
    expect(seen.slice(0, switchedAt).some((state) => state.startsWith("gpu")), seen.join(", ")).toBe(true);
    expect(seen.slice(0, switchedAt).filter((state) => state === "batch").length, seen.join(", ")).toBe(batchesBefore);

    await page.reload();
    await expect(page.getByRole("switch", { name: "Use the GPU for proofs" })).toHaveAttribute("aria-checked", "false");
    expect(errors).toEqual([]);
  });

  test("switched off, a 140-digit proof on /is-prime stays on the CPU", async ({ page }) => {
    const states = await watchStripping(page, "off");
    const prime = nextPrimeAfter(10n ** 139n);
    await page.goto(`/is-prime?n=${prime}`);
    await page.getByRole("button", { name: "Prove it" }).click();
    await expect(page.getByTestId("prime-check-headline")).toContainText("is prime.", { timeout: 60_000 });
    expect(await states()).toEqual(["cpu"]);
  });
});
