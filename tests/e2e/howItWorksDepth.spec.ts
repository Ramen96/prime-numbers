import { expect, test, type Page } from "@playwright/test";

// /how-it-works in layered depth (lib/howItWorksDepth.ts, DepthSection.tsx,
// DepthSwitch.tsx): every level in the HTML, A bit deeper by default, a switch
// that opens every section to a level, single sections opening on their own,
// ?level= links, a remembered choice, anchors into deeper levels, and no
// JavaScript needed to read any of it.

const LEVEL_NAMES = ["The basics", "A bit deeper", "Under the hood", "Turtles all the way down"];
/** Every section and its deepest level, as built. */
const SECTION_DEPTHS: Record<string, number> = {
  "what-is-a-prime-number": 3,
  "sieve-of-eratosthenes": 2,
  "segmented-sieve": 4,
  "constant-memory-infinite-scroll": 3,
  "how-many-primes-below-x": 4,
  "javascript-number-limit": 4,
  "proving-huge-primes": 3,
  "independent-checks": 2,
  "gpu-proofs": 4,
  "displaying-long-primes": 2,
  "measuring-speed": 3,
};
/** Ids that were sections before the layering, now inside merged ones: links to them must still land. */
const MOVED_ANCHORS = ["why-check-up-to-square-root", "ramanujan-series", "estimated-positions", "numbers-bigger-than-64-bits"];

/** A section's toggle for `level` (2 to 4). */
function toggle(page: Page, sectionId: string, level: number) {
  return page.locator(`section[aria-labelledby="${sectionId}"] details[data-depth="${level}"] > summary`);
}

/** For each section, which of its levels are open: [level 2 open?, level 3 open?, …]. */
async function openLevels(page: Page): Promise<Record<string, boolean[]>> {
  return page.evaluate(() => {
    const result: Record<string, boolean[]> = {};
    for (const section of document.querySelectorAll("section[aria-labelledby]")) {
      result[section.getAttribute("aria-labelledby")!] = [...section.querySelectorAll<HTMLDetailsElement>("details[data-depth]")].map(
        (details) => details.open,
      );
    }
    return result;
  });
}

/** What every section looks like opened to `level`. */
function expectedAt(level: number): Record<string, boolean[]> {
  return Object.fromEntries(
    Object.entries(SECTION_DEPTHS).map(([id, deepest]) => [id, Array.from({ length: deepest - 1 }, (_, index) => index + 2 <= level)]),
  );
}

test.describe("/how-it-works in layered depth", () => {
  test("every level of every section is in the HTML, A bit deeper open and the rest closed", async ({ request }) => {
    const html = await (await request.get("/how-it-works")).text();
    for (const [id, deepest] of Object.entries(SECTION_DEPTHS)) {
      const section = html.slice(html.indexOf(`<section aria-labelledby="${id}"`), html.indexOf("</section>", html.indexOf(`<section aria-labelledby="${id}"`)));
      expect(section.length, id).toBeGreaterThan(0);
      for (let level = 2; level <= 4; level++) {
        const present = section.includes(`data-depth="${level}"`);
        expect(present, `${id}, level ${level}`).toBe(level <= deepest);
      }
      expect(section).toMatch(/<details[^>]*data-depth="2"[^>]*open=""|<details[^>]*open=""[^>]*data-depth="2"/);
      expect(section).not.toMatch(/<details[^>]*data-depth="[34]"[^>]*open=""/);
    }
    // deep text a crawler gets without opening anything: a Turtles-level sentence
    expect(html).toContain("WebAssembly has no 128-bit division at all");
    for (const id of [...Object.keys(SECTION_DEPTHS), ...MOVED_ANCHORS, "big-mod-small", "small-inner-loop", "64-bit-remainder", "gpu-small-numbers"])
      expect(html, id).toContain(`id="${id}"`);
    // the switch does nothing without JavaScript, so it's hidden in the HTML
    expect(html).toMatch(/<fieldset id="depth-switch"[^>]*hidden=""/);
  });

  test("without JavaScript: two levels show, deeper ones open by hand, and the switch stays hidden", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/how-it-works?level=4");
    expect(await openLevels(page)).toEqual(expectedAt(2));
    await expect(page.getByTestId("depth-switch")).toBeHidden();
    await toggle(page, "segmented-sieve", 3).click();
    expect((await openLevels(page))["segmented-sieve"]).toEqual([true, true, false]);
    await context.close();
  });

  test("the switch opens every section to its level, and a single section opens and closes on its own", async ({ page }) => {
    await page.goto("/how-it-works");
    const depthSwitch = page.getByRole("group", { name: "How deep" });
    await expect(depthSwitch).toBeVisible();
    await expect(depthSwitch.getByRole("radio", { name: "A bit deeper" })).toBeChecked();
    expect(await openLevels(page)).toEqual(expectedAt(2));

    for (const level of [4, 1, 3, 2]) {
      await depthSwitch.getByText(LEVEL_NAMES[level - 1], { exact: true }).click();
      expect(await openLevels(page), `level ${level}`).toEqual(expectedAt(level));
      await expect(page).toHaveURL(new RegExp(`[?&]level=${level}`));
      await expect(page.getByRole("status").filter({ hasText: "Every section now opens to" })).toHaveText(`Every section now opens to ${LEVEL_NAMES[level - 1]}.`);
    }

    // one section deeper: only it changes, and the switch, address and saved choice don't
    await toggle(page, "gpu-proofs", 3).click();
    const opened = await openLevels(page);
    expect(opened["gpu-proofs"]).toEqual([true, true, false]);
    expect({ ...opened, "gpu-proofs": undefined }).toEqual({ ...expectedAt(2), "gpu-proofs": undefined });
    await expect(depthSwitch.getByRole("radio", { name: "A bit deeper" })).toBeChecked();
    await expect(page).toHaveURL(/[?&]level=2/);
    await toggle(page, "gpu-proofs", 2).click();
    expect((await openLevels(page))["gpu-proofs"]).toEqual([false, true, false]); // closed (what's inside keeps its own state)
  });

  test("?level= opens that far for this visit, the switch's choice is remembered, and a bad ?level= is ignored", async ({ page }) => {
    await page.goto("/how-it-works?level=4");
    expect(await openLevels(page)).toEqual(expectedAt(4));
    await expect(page.getByRole("radio", { name: "Turtles all the way down" })).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem("everyPrimeNumber.howItWorksDepth"))).toBeNull(); // a link isn't a choice

    await toggle(page, "proving-huge-primes", 3).click(); // a section's own toggle, not the switch
    await page.getByRole("group", { name: "How deep" }).getByText("The basics", { exact: true }).click();
    await page.goto("/how-it-works");
    expect(await openLevels(page)).toEqual(expectedAt(1));
    await expect(page.getByRole("radio", { name: "The basics" })).toBeChecked();

    await page.goto("/how-it-works?level=3");
    expect(await openLevels(page)).toEqual(expectedAt(3)); // the link beats the saved choice…
    await page.goto("/how-it-works?level=9");
    expect(await openLevels(page)).toEqual(expectedAt(1)); // …which is still kept, and a bad link falls back to it
  });

  test("a link into a deeper level opens the levels around it and lands there", async ({ page }) => {
    await page.goto("/how-it-works#64-bit-remainder");
    const heading = page.locator('[id="64-bit-remainder"]'); // an id starting with a digit isn't a CSS #selector
    await expect(heading).toBeVisible();
    await expect(heading).toBeInViewport();
    expect((await openLevels(page))["javascript-number-limit"]).toEqual([true, true, true]);
    // following an anchor on the page does the same
    await page.goto("/how-it-works?level=1");
    await page.evaluate(() => (window.location.hash = "ramanujan-series"));
    await expect(page.locator('[id="ramanujan-series"]')).toBeInViewport();
    for (const id of MOVED_ANCHORS) {
      await page.goto(`/how-it-works?level=1#${id}`);
      await expect(page.locator(`[id="${id}"]`), id).toBeInViewport();
    }
  });

  test("keyboard and screen readers: the switch is a radio group, and every toggle names its section", async ({ page }) => {
    await page.goto("/how-it-works");
    const toggles = page.locator("summary");
    expect(await toggles.count()).toBe(Object.values(SECTION_DEPTHS).reduce((sum, deepest) => sum + deepest - 1, 0));
    await expect(page.getByRole("group", { name: "How deep" })).toBeVisible();
    // a toggle's name: its level, then its section (the section's name for screen readers only)
    await expect(toggle(page, "segmented-sieve", 3)).toHaveText("Under the hood: How the segmented sieve of Eratosthenes works");
    // arrow keys move through the levels, and each choice applies at once
    await page.getByRole("radio", { name: "A bit deeper" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Under the hood" })).toBeChecked();
    expect(await openLevels(page)).toEqual(expectedAt(3));
    // a toggle opens with the keyboard
    await toggle(page, "sieve-of-eratosthenes", 2).focus();
    await page.keyboard.press("Enter");
    expect((await openLevels(page))["sieve-of-eratosthenes"]).toEqual([false]);
    // every toggle and choice on screen is at least 44 px tall
    const heights = await page.locator("summary, #depth-switch label").evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height).filter((height) => height > 0),
    );
    expect(heights.length).toBeGreaterThan(10);
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
  });

  test("a saved depth is applied before the first paint: nothing shifts as the page loads", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("everyPrimeNumber.howItWorksDepth", "4");
      (window as unknown as { shifts: number }).shifts = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[])
          if (!entry.hadRecentInput) (window as unknown as { shifts: number }).shifts += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/how-it-works");
    expect(await openLevels(page)).toEqual(expectedAt(4));
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { shifts: number }).shifts)).toBeLessThan(0.01);
  });

  for (const width of [320, 280]) {
    test(`nothing scrolls sideways at ${width} px, at the shallowest and deepest levels`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const level of [1, 4]) {
        await page.goto(`/how-it-works?level=${level}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `level ${level}`).toBe(0);
      }
    });
  }

  test("the demos are there at The basics, working as before", async ({ page }) => {
    await page.goto("/how-it-works?level=1");
    await expect(page.getByRole("button", { name: "Next step" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Next window" })).toBeVisible();
  });
});
