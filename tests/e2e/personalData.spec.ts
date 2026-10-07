import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrimeListPage } from "./primeListPage";

const STORAGE_KEY = "everyPrimeNumber.personalData";

function storedData(favorites: string[], records = { furthestScroll: null, biggestPrimeVisited: null } as Record<string, string | null>) {
  return JSON.stringify({ version: 1, favorites, records });
}

/** Seeds localStorage once, before the app's first load (not again on reload). */
async function seedStorageOnce(page: Page, value: string) {
  await page.addInitScript(
    ([key, seededValue]) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(key, seededValue);
        sessionStorage.setItem("seeded", "yes");
      }
    },
    [STORAGE_KEY, value],
  );
}

function starButton(page: Page, formattedPrime: string): Locator {
  return page.getByRole("button", { name: `Favorite ${formattedPrime}`, exact: true });
}

/** The /favorites page's list of favorite primes (absent while there are none). */
function favoritesList(page: Page): Locator {
  return page.getByRole("list", { name: "Favorite primes" });
}

async function statValue(page: Page, label: string): Promise<string> {
  return page.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]").innerText();
}

function parseNumber(text: string): number {
  return Number(text.replace(/[^\d]/g, ""));
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  return errors;
}

test.describe("favorites", () => {
  test("favorite a prime on the home page, it's on /favorites, remove it there and the star clears", async ({
    page,
  }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await starButton(page, "13").click();
    await expect(starButton(page, "13")).toHaveAttribute("aria-pressed", "true");

    await page.reload(); // still there after a reload
    await expect(starButton(page, "13")).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Favorites" }).click();
    await expect(page).toHaveURL("/favorites");
    await expect(page.getByTestId("favorites-count")).toHaveText("1 favorite");
    await expect(favoritesList(page).getByRole("listitem")).toHaveText([/^13View in list/]);

    await page.getByRole("button", { name: "Remove 13 from favorites" }).click();
    await expect(page.getByText("No favorites yet.")).toBeVisible();

    await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Home" }).click();
    await expect(starButton(page, "13")).toHaveAttribute("aria-pressed", "false");
  });

  test("“View in list” jumps the list to the favorite", async ({ page }) => {
    await seedStorageOnce(page, storedData(["13", "1000000007"]));
    await page.goto("/favorites");
    await page.getByRole("link", { name: "View in list (1,000,000,007)" }).click();

    const primeListPage = new PrimeListPage(page);
    await expect(page).toHaveURL("/?jump=1000000007");
    await expect(primeListPage.jumpFeedback).toContainText("Jumped to 1,000,000,007");
    await primeListPage.waitForWorkerToFinish();
    expect((await primeListPage.topVisibleRow()).prime).toBe(1_000_000_007);
  });

  test("lists favorites in numeric order, including ones far past 2^64", async ({ page }) => {
    const farPast2To64 = (2n ** 200n + 235n).toString();
    await seedStorageOnce(page, storedData([farPast2To64, "1000003", "97"]));
    await page.goto("/favorites");
    await expect(page.getByTestId("favorites-count")).toHaveText("3 favorites");
    await expect(favoritesList(page).getByRole("listitem")).toHaveText([
      /^97View in list/,
      /^1,000,003View in list/,
      /^1,606,938,044,258,990/,
    ]);
  });

  test("an empty list explains how to add a favorite", async ({ page }) => {
    await page.goto("/favorites");
    await expect(page.getByText("No favorites yet. Tap the ☆ next to any prime")).toBeVisible();
  });

  test("the star is a 44px toggle button", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "tap targets matter on phones");
    await new PrimeListPage(page).open();
    const box = await starButton(page, "13").boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
    await starButton(page, "13").focus();
    await page.keyboard.press("Enter");
    await expect(starButton(page, "13")).toHaveAttribute("aria-pressed", "true");
  });

  test("the remove button is a 44px target", async ({ page }) => {
    await seedStorageOnce(page, storedData(["13"]));
    await page.goto("/favorites");
    const box = await page.getByRole("button", { name: "Remove 13 from favorites" }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  });
});

test.describe("personal records", () => {
  test("scrolling updates furthest scroll, jumping only biggest visited, reset clears both", async ({
    page,
  }) => {
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await expect.poll(async () => parseNumber(await statValue(page, "furthest scroll"))).toBeGreaterThan(0);
    const furthestOnLoad = parseNumber(await statValue(page, "furthest scroll"));

    // Scrolling from 2 counts.
    await primeListPage.scrollByRows(300);
    await expect.poll(async () => parseNumber(await statValue(page, "furthest scroll"))).toBeGreaterThan(furthestOnLoad);
    await expect.poll(async () => statValue(page, "biggest visited")).toBe(await statValue(page, "furthest scroll"));
    await expect(page.getByText("New record!")).toBeHidden(); // a first visit has no record to beat
    const furthestBeforeJumping = await statValue(page, "furthest scroll");

    // After a jump, only "biggest visited" moves, even when scrolling on from there.
    await primeListPage.jumpTo("1,000,000");
    await primeListPage.scrollByRows(50);
    await expect.poll(async () => parseNumber(await statValue(page, "biggest visited"))).toBeGreaterThan(1_000_003);
    expect(await statValue(page, "furthest scroll")).toBe(furthestBeforeJumping);

    // Reset on /favorites, with its confirmation step; the home page shows it too.
    await primeListPage.waitForRecordsToSave();
    await page.goto("/favorites");
    expect(await statValue(page, "furthest scroll")).toBe(furthestBeforeJumping);
    await page.getByRole("button", { name: "Reset records" }).click();
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    expect(await statValue(page, "furthest scroll")).toBe("—");
    expect(await statValue(page, "biggest visited")).toBe("—");
    await page.goto("/");
    expect(await statValue(page, "biggest visited")).not.toBe("1,000,003");
  });

  test("beating an existing furthest-scroll record says “New record!”", async ({ page }) => {
    await seedStorageOnce(page, storedData([], { furthestScroll: "113", biggestPrimeVisited: "113" }));
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();
    await primeListPage.scrollByRows(100);
    await expect(page.getByText("New record!")).toBeVisible();
  });
});

test.describe("when storage misbehaves", () => {
  test("with localStorage blocked, the page works and shows no errors", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      });
    });
    const errors = collectErrors(page);
    const primeListPage = new PrimeListPage(page);
    await primeListPage.open();

    await starButton(page, "13").click(); // works for this visit, just isn't saved
    await expect(starButton(page, "13")).toHaveAttribute("aria-pressed", "true");
    await primeListPage.scrollByRows(200);
    await primeListPage.jumpTo("1,000,000");
    expect((await primeListPage.topVisibleRow()).prime).toBe(1_000_003);
    expect(errors).toEqual([]);
  });

  test("with storage full, saving says so", async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      };
    });
    await new PrimeListPage(page).open();
    await starButton(page, "13").click();
    await expect(page.getByText("Your browser’s storage is full")).toBeVisible();
  });

  test("stored data doesn't cause hydration errors", async ({ page }) => {
    await seedStorageOnce(page, storedData(["13"], { furthestScroll: "7919", biggestPrimeVisited: "1000003" }));
    const errors = collectErrors(page);
    await new PrimeListPage(page).open();
    await expect(starButton(page, "13")).toHaveAttribute("aria-pressed", "true");
    expect(await statValue(page, "biggest visited")).toBe("1,000,003");
    expect(errors).toEqual([]);
  });
});

test("two tabs stay in sync when a favorite is added", async ({ context }) => {
  const homeTab = await context.newPage();
  const otherHomeTab = await context.newPage();
  const favoritesTab = await context.newPage();
  await new PrimeListPage(homeTab).open();
  await new PrimeListPage(otherHomeTab).open();
  await favoritesTab.goto("/favorites");
  await expect(favoritesTab.getByText("No favorites yet.")).toBeVisible();

  await starButton(homeTab, "13").click();
  await expect(starButton(otherHomeTab, "13")).toHaveAttribute("aria-pressed", "true");
  await expect(favoritesTab.getByTestId("favorites-count")).toHaveText("1 favorite");
  await expect(favoritesList(favoritesTab).getByRole("listitem")).toHaveText([/^13View in list/]);
});
