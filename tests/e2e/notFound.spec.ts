import { expect, test } from "@playwright/test";

test.describe("404 page", () => {
  test("an unknown URL returns 404 with the custom page and nav in the HTML", async ({ request }) => {
    const response = await request.get("/this-page-is-not-prime");
    expect(response.status()).toBe(404);
    const html = await response.text();
    expect(html).toMatch(/<h1[^>]*>404 is not prime<\/h1>/);
    expect(html).toContain("404 = 2² × 101");
    expect(html).toMatch(/<nav[^>]*aria-label="Site"/);
  });

  test("links back to the primes", async ({ page }) => {
    await page.goto("/this-page-is-not-prime");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("404 is not prime");
    await expect(page.getByRole("navigation", { name: "Site" })).toBeVisible();
    await page.getByRole("link", { name: "Back to the primes" }).click();
    await expect(page).toHaveURL("/");
  });

  test("sieves 400–409 down to 401 and 409, with 404 crossed out by 2", async ({ page }) => {
    await page.goto("/this-page-is-not-prime");
    const sieve = page.getByTestId("not-found-sieve");
    await expect(sieve.locator("li")).toHaveText([
      "400by 2", "401", "402by 2", "403by 13", "404by 2",
      "405by 3", "406by 2", "407by 11", "408by 2", "409",
    ]);
    await expect(sieve).toHaveAttribute("aria-hidden", "true");
    await expect(sieve.locator("li", { hasText: "404" })).toHaveAttribute("data-crossed-out-by", "2");
    await expect(page.locator("figcaption")).toHaveText(
      "The sieve of Eratosthenes on 400 to 409: each number is crossed out by its smallest prime factor, " +
        "and 404 goes in the first pass, with 2. Only 401 and 409 survive.",
    );
  });

  test("shows the finished sieve at once under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/this-page-is-not-prime");
    const strikeOn404 = await page
      .getByTestId("not-found-sieve")
      .locator("li", { hasText: "404" })
      .locator("span")
      .first()
      .evaluate((number) => getComputedStyle(number, "::after").animationName);
    expect(strikeOn404).toBe("none");
  });
});
