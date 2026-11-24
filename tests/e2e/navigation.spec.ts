import { expect, test, type Page, type TestInfo } from "@playwright/test";

// Every page is one step away (NavLinks.tsx): the desktop sidebar lists them all
// in three groups; on phones the bar has Home, Is it prime?, Favorites and a
// Menu (a popover) with the same groups.

const GITHUB_URL = "https://github.com/Ramen96/prime-numbers";
const PAGES = [
  { path: "/", linkName: "Home" },
  { path: "/is-prime", linkName: "Is it prime?" },
  { path: "/random-prime", linkName: "Random prime" },
  { path: "/favorites", linkName: "Favorites" },
  { path: "/what-is-a-prime-number", linkName: "What is a prime?" },
  { path: "/how-to-tell-if-a-number-is-prime", linkName: "Checking by hand" },
  { path: "/mersenne-primes", linkName: "Mersenne primes" },
  { path: "/fun-facts", linkName: "Fun facts" },
  { path: "/how-it-works", linkName: "How it works" },
  { path: "/about", linkName: "About" },
] as const;

const isPhone = (testInfo: TestInfo) => testInfo.project.name === "phone";
const siteNav = (page: Page) => page.getByRole("navigation", { name: "Site" });
const menuButton = (page: Page) => siteNav(page).getByRole("button", { name: "Menu" });
const menu = (page: Page) => page.getByTestId("site-menu");

/** Where every page's link is: the sidebar on desktop; the opened menu on phones. */
async function fullList(page: Page, testInfo: TestInfo) {
  if (!isPhone(testInfo)) return page.getByTestId("site-nav-list");
  await menuButton(page).click();
  await expect(menu(page)).toBeVisible();
  return menu(page);
}

test.describe("site navigation", () => {
  for (const { path, linkName } of PAGES) {
    test(`is in the raw HTML of ${path}, every page linked, the current one marked`, async ({ request }) => {
      const html = await (await request.get(path)).text();
      expect(html).toMatch(/<nav[^>]*aria-label="Site"/);
      for (const otherPage of PAGES) expect(html).toContain(`href="${otherPage.path}"`);
      expect(html).toContain(`href="${GITHUB_URL}"`);
      expect(html).toMatch(new RegExp(`<a[^>]*aria-current="page"[^>]*href="${path}"[^>]*>[\\s\\S]*?${linkName.replace("?", "\\?")}[\\s\\S]*?</a>`));
    });
  }

  test("reaches every page, in three groups, and marks the current one", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.goto("/");
    for (const { path, linkName } of PAGES) {
      const list = await fullList(page, testInfo);
      for (const heading of ["Learn", "This site"]) await expect(list.getByText(heading, { exact: true })).toBeVisible();
      await list.getByRole("link", { name: linkName, exact: true }).click();
      await expect(page).toHaveURL(path);
      if (isPhone(testInfo)) await expect(menu(page)).toBeHidden(); // following a link closes the menu
      const listAgain = await fullList(page, testInfo);
      await expect(listAgain.getByRole("link", { name: linkName, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(listAgain.locator('[aria-current="page"]')).toHaveCount(1);
      if (isPhone(testInfo)) await page.keyboard.press("Escape");
    }
  });

  test("GitHub opens in a new tab and has an accessible name", async ({ page }, testInfo) => {
    await page.goto("/about");
    const github = (await fullList(page, testInfo)).getByRole("link", { name: "GitHub (opens in a new tab)" });
    await expect(github).toBeVisible();
    await expect(github).toHaveAttribute("href", GITHUB_URL);
    await expect(github).toHaveAttribute("target", "_blank");
    await expect(github).toHaveAttribute("rel", /noopener/);
  });

  test("works from the keyboard", async ({ page }, testInfo) => {
    await page.goto("/");
    if (isPhone(testInfo)) {
      await menuButton(page).focus();
      await page.keyboard.press("Enter");
      await expect(menu(page).getByRole("link", { name: "Home", exact: true })).toBeFocused(); // focus goes in
      await page.keyboard.press("Escape");
      await expect(menu(page)).toBeHidden();
      await expect(menuButton(page)).toBeFocused(); // and comes back
      await menuButton(page).press("Enter");
      await expect(menu(page).getByRole("link", { name: "Home", exact: true })).toBeFocused();
    }
    const link = (isPhone(testInfo) ? menu(page) : page.getByTestId("site-nav-list")).getByRole("link", {
      name: "How it works",
      exact: true,
    });
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/how-it-works");
  });

  test("the phone menu closes with ☰, a tap outside, or Escape", async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone layout only");
    await page.goto("/about");
    await expect(menu(page)).toBeHidden();
    await menuButton(page).click();
    await expect(menu(page)).toBeVisible();
    await menuButton(page).click();
    await expect(menu(page)).toBeHidden();
    await menuButton(page).click();
    await page.mouse.click(200, 760); // below the menu
    await expect(menu(page)).toBeHidden();
    await menuButton(page).click();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();
    await expect(page).toHaveURL("/about");
  });

  test("is a sidebar on desktop and a top bar on phones, never both", async ({ page }, testInfo) => {
    await page.goto("/");
    const nav = siteNav(page);
    await expect(nav).toHaveCount(1);
    const navBox = (await nav.boundingBox())!;
    const viewport = page.viewportSize()!;
    if (isPhone(testInfo)) {
      expect(navBox.y).toBe(0);
      expect(navBox.width).toBeCloseTo(viewport.width, 0);
      expect(navBox.height).toBeLessThanOrEqual(48);
      await expect(page.getByTestId("site-nav-list")).toBeHidden();
    } else {
      expect(navBox.height).toBeCloseTo(viewport.height, 0);
      expect(navBox.width).toBeLessThan(200);
      await expect(menuButton(page)).toBeHidden();
    }
  });

  test("tap targets are at least 44px tall on phones, in the bar and the menu", async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone layout only");
    await page.goto("/");
    const barTargets = page.getByTestId("site-nav-bar").locator("a, button");
    for (const target of await barTargets.all()) expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await menuButton(page).click();
    for (const link of await menu(page).getByRole("link").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("the sidebar shows every link and the credit at 1024 × 600, the smallest desktop, without scrolling", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop layout only");
    await page.setViewportSize({ width: 1024, height: 600 });
    for (const path of ["/", "/mersenne-primes"]) {
      await page.goto(path);
      const list = page.getByTestId("site-nav-list");
      expect(await list.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
      for (const link of await list.getByRole("link").all()) {
        await expect(link).toBeInViewport({ ratio: 1 });
        expect((await link.boundingBox())!.height).toBeLessThan(40); // one line each, even the current page
      }
      await expect(siteNav(page).getByText("Built by")).toBeInViewport();
    }
  });
});

test.describe("the phone bar", () => {
  test("stays one row, no label wrapping, from 280 to 420 px", async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), "the widths are set here, so run once");
    for (let width = 280; width <= 420; width += 10) {
      await page.setViewportSize({ width, height: 740 });
      await page.goto("/");
      const targets = await page.getByTestId("site-nav-bar").locator("a, button").all();
      const tops = new Set<number>();
      for (const target of targets) {
        const box = (await target.boundingBox())!;
        tops.add(Math.round(box.y));
        expect(box.height, `${width} px`).toBeLessThanOrEqual(46);
      }
      expect(tops.size, `${width} px`).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  });
});
