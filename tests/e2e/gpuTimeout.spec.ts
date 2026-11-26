import { nextPrimeAfter } from "../support/primality";
import { collectErrors, expectDownloadedCertificateProves, watchStripping } from "./gpuStrippingPage";
import { expect, GPU_RESULTS_NEVER_COME_BACK, test } from "./hardwareGpuStandIn";

// A GPU whose answers never come back, as Firefox was seen to do (proofs froze
// with no error): SwiftShader passed off as hardware (hardwareGpuStandIn.ts) whose
// mapAsync never settles, in every worker. The call times out
// (GPU_CALL_TIMEOUT_MS), the proof goes on on the CPU and the GPU stays off for
// the session. Only the "webgpu" project runs this file.

test.use({ furtherWorkerPatch: GPU_RESULTS_NEVER_COME_BACK });

test("a 140-digit proof isn't left waiting: after the timeout it finishes on the CPU, and the GPU stays off", async ({ page }) => {
  const errors = collectErrors(page);
  const states = await watchStripping(page);
  const prime = nextPrimeAfter(10n ** 139n);
  await page.goto(`/is-prime?n=${prime}`);
  await page.getByRole("button", { name: "Prove it" }).click();
  await expect(page.getByTestId("prime-check-headline")).toContainText("is prime.", { timeout: 60_000 });
  await expectDownloadedCertificateProves(page, prime);
  const seen = await states();
  expect(seen, seen.join(", ")).toContain("failed");
  expect(seen.at(-1), seen.join(", ")).toBe("failed");
  expect(errors).toEqual([]);
});
