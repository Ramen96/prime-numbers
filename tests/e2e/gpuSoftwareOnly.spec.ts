import { expect, test } from "@playwright/test";
import { nextPrimeAfter } from "../support/primality";
import { collectErrors, expectDownloadedCertificateProves, watchStripping } from "./gpuStrippingPage";

// Only a software GPU (step 11f): the "webgpu" project's headless Chromium has
// SwiftShader, as Chromium with --enable-unsafe-webgpu gives on a machine with no
// GPU it can use. It runs on the processor and is slower than the CPU's own
// proofs, so the site takes it for no GPU at all (lib/gpuAdapter.ts).

test.describe("GPU stripping, with only a software GPU", () => {
  test("the adapter is SwiftShader, and the switch is greyed out", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate(async () => (await navigator.gpu?.requestAdapter())?.info.architecture)).toBe("swiftshader");
    const gpuSwitch = page.getByRole("switch", { name: "Use the GPU for proofs" });
    await expect(page.getByTestId("gpu-row-text")).toHaveText("not available here");
    await expect(gpuSwitch).toBeDisabled();
    await expect(gpuSwitch).toHaveAttribute("aria-checked", "false");
  });

  test("a 140-digit proof stays on the CPU, and its certificate checks", async ({ page }) => {
    const errors = collectErrors(page);
    const states = await watchStripping(page);
    const prime = nextPrimeAfter(10n ** 139n);
    await page.goto(`/is-prime?n=${prime}`);
    await page.getByRole("button", { name: "Prove it" }).click();
    await expect(page.getByTestId("prime-check-headline")).toContainText("is prime.", { timeout: 60_000 });
    await expectDownloadedCertificateProves(page, prime);
    expect(await states()).toEqual(["cpu", "unavailable"]);
    expect(errors).toEqual([]);
  });
});
