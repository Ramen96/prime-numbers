import { expect, test } from "@playwright/test";
import { nextPrimeAfter } from "../support/primality";
import { collectErrors, expectDownloadedCertificateProves, watchStripping } from "./gpuStrippingPage";

// GPU stripping asked for where there's no WebGPU adapter: headless Chromium
// without flags, like a browser or device that can't run WebGPU. The CPU does
// everything. (The GPU path itself is tested in gpuStripping.spec.ts.)

test.describe("GPU stripping, without WebGPU", () => {
  test("asked for but unavailable: the CPU proves everything, and nothing breaks", async ({ page }) => {
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
