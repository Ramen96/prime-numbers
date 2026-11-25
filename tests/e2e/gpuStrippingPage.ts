// Helpers for the GPU stripping e2e tests (gpuStripping.spec.ts on a software GPU,
// gpuUnavailable.spec.ts without one).

import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { certificateFromJson } from "../../lib/certificateExport.ts";
import { checkCertificate } from "../../lib/primes/primalityCertificate.ts";
import { nextPrimeAfter } from "../support/primality";

/**
 * Sets the GPU switch as the home page's switch stores it (null: left at the
 * default) and records every stripping status the page's workers send; with
 * `markBatches`, also "batch" each time a batch of the list ends.
 */
export async function watchStripping(page: Page, preference: "on" | "off" | null = "on", { markBatches = false } = {}) {
  await page.addInitScript(({ preference, markBatches }) => {
    if (preference) localStorage.setItem("everyPrimeNumber.gpu", preference);
    const states: string[] = [];
    (window as unknown as { strippingStates: string[] }).strippingStates = states;
    const PageWorker = window.Worker;
    window.Worker = class extends PageWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event: MessageEvent) => {
          const message = event.data as { type?: string; status?: { state: string; largestPrime?: number | null } };
          if (markBatches && message?.type === "batch") states.push("batch");
          if (message?.type !== "stripping" || !message.status) return;
          const { state, largestPrime } = message.status;
          states.push(state === "gpu" && largestPrime ? `gpu ${largestPrime}` : state);
        });
      }
    };
  }, { preference, markBatches });
  return () => page.evaluate(() => (window as unknown as { strippingStates: string[] }).strippingStates);
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  return errors;
}

/** Each prime is the one right after the last (by the independent test reference): none skipped. */
export function expectConsecutivePrimes(primes: bigint[]) {
  expect(primes.length).toBeGreaterThan(1);
  for (let index = 1; index < primes.length; index++) {
    expect(primes[index], `the prime after ${primes[index - 1]}`).toBe(nextPrimeAfter(primes[index - 1]));
  }
}

/** Downloads the JSON certificate and checks it here, independently of the page. */
export async function expectDownloadedCertificateProves(page: Page, prime: bigint) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download as JSON" }).click()]);
  const { prime: certified, steps } = certificateFromJson(await readFile((await download.path())!, "utf8"));
  expect(certified).toBe(prime);
  expect(checkCertificate(prime, steps)).toEqual({ valid: true });
}

/** The GPU stripped: the depth only comes with the answer to a strip call. And it never failed or lied. */
export function expectStrippedOnTheGpu(states: string[]) {
  expect(states.some((state) => /^gpu \d+$/.test(state)), states.join(", ")).toBe(true);
  expect(states).not.toContain("failed");
  expect(states).not.toContain("unavailable");
}
