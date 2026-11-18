import { expect, test } from "@playwright/test";
import { expectLabelsConsecutive, PrimeListPage } from "./primeListPage";

const BATCH_SIZE = 500;

test.describe("position labels", () => {
  test("stay consecutive across batch boundaries in both directions after a jump", async ({
    page,
  }) => {
    // 180 scroll steps, each waiting for the worker: about 9 s alone, but well past the
    // default 30 s when tests proving primes past a(13) keep every core busy alongside it.
    test.setTimeout(90_000);
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await primeListPage.jumpTo("1,000,000,000");
    const anchorRow = await primeListPage.topVisibleRow();
    expect(anchorRow.label).toMatch(/^≈ #/);

    // Up past the batch loaded below the jump point, into one fetched while scrolling.
    for (let step = 0; step < 60; step++) {
      await primeListPage.scrollByRows(-10);
      expectLabelsConsecutive(await primeListPage.visibleRows());
    }
    const rowAfterScrollingUp = await primeListPage.topVisibleRow();
    expect(anchorRow.ordinal - rowAfterScrollingUp.ordinal).toBeGreaterThan(BATCH_SIZE);

    // Back down past the jump point and the batch above it.
    for (let step = 0; step < 120; step++) {
      await primeListPage.scrollByRows(10);
      expectLabelsConsecutive(await primeListPage.visibleRows());
    }
    const rowAfterScrollingDown = await primeListPage.topVisibleRow();
    expect(rowAfterScrollingDown.ordinal - anchorRow.ordinal).toBeGreaterThan(BATCH_SIZE);

    // Still estimates throughout: we never reached 2.
    expect(rowAfterScrollingDown.label).toMatch(/^≈ #/);
  });
});
