import { expect, test, type Page } from "@playwright/test";
import { nextPrimeAfter } from "../support/primality";
import { PrimeListPage } from "./primeListPage";

// Values at and past 2^63 and 2^64 must travel from C, through the worker,
// to the page exactly, in both directions. Wasm hands integers to JavaScript
// as *signed* values, so anything mishandled at 2^63 would show up here as a
// wrong or negative number.

const TWO_TO_THE_63 = 2n ** 63n;
const TWO_TO_THE_64 = 2n ** 64n;
const formatted = (value: bigint) => value.toLocaleString("en-US");

/** The visible primes are exact, consecutive primes with nothing skipped. */
async function expectVisiblePrimesConsecutive(primeListPage: PrimeListPage): Promise<bigint[]> {
  const primes = await primeListPage.visiblePrimesExact();
  expect(primes.length).toBeGreaterThan(5);
  for (let index = 1; index < primes.length; index++) {
    expect(primes[index], `the prime after ${primes[index - 1]}`).toBe(nextPrimeAfter(primes[index - 1]));
  }
  return primes;
}

/** No prime, position label, offset or stat ever reaches the page as a negative number. */
async function expectNothingNegative(primeListPage: PrimeListPage) {
  for (const text of await primeListPage.allDisplayedNumbers()) {
    expect(text, "a negative number on the page").not.toMatch(/[-−]\s*\d/);
  }
}

/**
 * Scrolls a few rows at a time until the visible primes straddle `boundary`.
 * Returns them (checked to be consecutive primes).
 */
async function scrollUntilStraddling(primeListPage: PrimeListPage, boundary: bigint, rowsPerStep: number) {
  for (let step = 0; step < 100; step++) {
    const primes = await primeListPage.visiblePrimesExact();
    if (primes[0] < boundary && primes[primes.length - 1] > boundary) {
      return expectVisiblePrimesConsecutive(primeListPage);
    }
    await primeListPage.scrollByRows(rowsPerStep);
  }
  throw new Error(`never saw primes on both sides of ${boundary}`);
}

/**
 * Jumps just below `boundary` and scrolls down across it (primes coming from
 * C's "next"), then jumps just past it and scrolls up across it (from "prev").
 */
async function checkBothDirectionsAcross(page: Page, boundary: bigint) {
  const primeListPage = new PrimeListPage(page);
  await primeListPage.open();

  // Just below: the jump's own batch already reaches past the boundary going up.
  const justBelow = boundary - 3000n;
  await primeListPage.jumpTo(formatted(justBelow));
  const firstPrime = nextPrimeAfter(justBelow - 1n);
  await expect(primeListPage.jumpFeedback).toContainText(`Jumped to ${formatted(firstPrime)}`);
  expect((await primeListPage.visiblePrimesExact())[0]).toBe(firstPrime);
  await scrollUntilStraddling(primeListPage, boundary, 3); // across the boundary
  await primeListPage.scrollByRows(600); // into a batch fetched by scrolling ("next")
  await expectVisiblePrimesConsecutive(primeListPage);
  await expectNothingNegative(primeListPage);

  // Just past: the batch below the jump point comes from "prev" and crosses back down.
  const justPast = boundary + 1000n;
  await primeListPage.jumpTo(formatted(justPast));
  expect((await primeListPage.visiblePrimesExact())[0]).toBe(nextPrimeAfter(justPast - 1n));
  await scrollUntilStraddling(primeListPage, boundary, -3); // back across the boundary
  await primeListPage.scrollByRows(-600); // into a batch fetched by scrolling ("prev")
  await expectVisiblePrimesConsecutive(primeListPage);
  await expectNothingNegative(primeListPage);
}

test.describe("primes at and past 2^63", () => {
  test("round-trip exactly in both directions, never negative", async ({ page }) => {
    test.setTimeout(120_000); // builds every base prime up to about 3 × 10^9
    await checkBothDirectionsAcross(page, TWO_TO_THE_63);
  });
});

test.describe("primes at and past 2^64", () => {
  test(
    "round-trip exactly in both directions, never negative",
    { tag: "@slow" },
    async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "slow: desktop only");
      test.setTimeout(240_000); // builds every base prime up to about 4.3 × 10^9
      await checkBothDirectionsAcross(page, TWO_TO_THE_64);
    },
  );
});
