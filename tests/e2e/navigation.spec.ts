import { expect, test } from "@playwright/test";

const GITHUB_URL = "https://github.com/Ramen96/prime-numbers";
const PAGES = [
  { path: "/", linkName: "Home" },
  { path: "/how-it-works", linkName: "How it works" },
  { path: "/about", linkName: "About" },
] as const;

test.describe("site navigation", () => {
  for (const { path, linkName } of PAGES) {
    test(`is in the raw HTML of ${path}, with the current page marked`, async ({ request }) => {
      const html = await (await request.get(path)).text();
      expect(html).toMatch(/<nav[^>]*aria-label="Site"/);
      for (const otherPage of PAGES) expect(html).toContain(`href="${otherPage.path}"`);
      expect(html).toContain(`href="${GITHUB_URL}"`);
      expect(html).toMatch(
        new RegExp(`<a[^>]*aria-current="page"[^>]*href="${path}"[^>]*>${linkName}</a>`),
      );
    });
  }

  test("links navigate to each page and move aria-current along", async ({ page }) => {
    await page.goto("/");
    const siteNav = page.getByRole("navigation", { name: "Site" });

    for (const { path, linkName } of [PAGES[1], PAGES[2], PAGES[0]]) {
      await siteNav.getByRole("link", { name: linkName, exact: true }).click();
      await expect(page).toHaveURL(path);
      await expect(siteNav.getByRole("link", { name: linkName, exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(siteNav.locator('[aria-current="page"]')).toHaveCount(1);
    }
  });

  test("works from the keyboard", async ({ page }) => {
    await page.goto("/");
    const howItWorksLink = page
      .getByRole("navigation", { name: "Site" })
      .getByRole("link", { name: "How it works", exact: true });
    await howItWorksLink.focus();
    await expect(howItWorksLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/how-it-works");
  });

  test("GitHub opens in a new tab and has an accessible name", async ({ page }) => {
    await page.goto("/about");
    const githubLink = page
      .getByRole("navigation", { name: "Site" })
      .getByRole("link", { name: "GitHub (opens in a new tab)" });
    await expect(githubLink).toHaveAttribute("href", GITHUB_URL);
    await expect(githubLink).toHaveAttribute("target", "_blank");
    await expect(githubLink).toHaveAttribute("rel", /noopener/);
  });

  test("is a sidebar on desktop and a top bar on phones, never both", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    const siteNavs = page.getByRole("navigation", { name: "Site" });
    await expect(siteNavs).toHaveCount(1);
    const navBox = (await siteNavs.boundingBox())!;
    const viewport = page.viewportSize()!;

    if (testInfo.project.name === "desktop") {
      expect(navBox.height).toBeCloseTo(viewport.height, 0);
      expect(navBox.width).toBeLessThan(200);
    } else {
      expect(navBox.y).toBe(0);
      expect(navBox.width).toBeCloseTo(viewport.width, 0);
      expect(navBox.height).toBeLessThanOrEqual(48);
    }
  });

  test("tap targets are at least 44px tall on phones", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "phone layout only");
    await page.goto("/");
    const navLinks = page.getByRole("navigation", { name: "Site" }).getByRole("link");
    for (const navLink of await navLinks.all()) {
      const box = await navLink.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("site navigation on a 360px phone", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("fits every link on one row", async ({ page }) => {
    await page.goto("/");
    const navLinks = page.getByRole("navigation", { name: "Site" }).getByRole("link");
    const visibleLinkTops = new Set<number>();
    for (const navLink of await navLinks.all()) {
      if (await navLink.isVisible()) visibleLinkTops.add(Math.round((await navLink.boundingBox())!.y));
    }
    expect(visibleLinkTops.size).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});
