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
});
