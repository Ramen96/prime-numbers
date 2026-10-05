import { expect, test } from "@playwright/test";
import { PrimeListPage } from "./primeListPage";

test.describe("jumping", () => {
  test("back-to-back jumps never show batches from the earlier jump", async ({ page }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();

    // Jump far away, then jump again before the first jump's batch is ready.
    await primeListPage.jumpTo("1,000,000,000,000", { waitForLanding: false });
    await primeListPage.jumpTo("100");

    // The worker handles requests in order, so by the time the second jump
    // lands, the first jump's batch has already arrived and been ignored.
    await expect(primeListPage.jumpFeedback).toContainText("Jumped to 101");
    expect(await primeListPage.topVisibleRow()).toMatchObject({ prime: 101, label: "#26" });

    const renderedPrimes = await primeListPage.renderedPrimes();
    const primesFromEarlierJump = renderedPrimes.filter((prime) => prime >= 1_000_000_000_000);
    expect(primesFromEarlierJump).toEqual([]);
  });
});
