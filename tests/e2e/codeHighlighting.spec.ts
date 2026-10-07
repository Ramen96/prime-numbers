import { expect, test } from "@playwright/test";

test.describe("code samples on /how-it-works", () => {
  test("are highlighted in the server-rendered HTML", async ({ request }) => {
    const html = await (await request.get("/how-it-works")).text();
    const highlightedBlocks = html.match(/<pre class="shiki[^"]*"[\s\S]*?<\/pre>/g) ?? [];
    expect(highlightedBlocks).toHaveLength(2);
    for (const block of highlightedBlocks) {
      // Every token carries its colour for both themes.
      const coloredTokens = block.match(/<span style="--shiki-light:#[0-9a-fA-F]{6};--shiki-dark:#[0-9a-fA-F]{6}"/g) ?? [];
      expect(coloredTokens.length).toBeGreaterThan(20);
    }
    expect(html).toMatch(/<span style="--shiki-light:#[0-9a-fA-F]{6};--shiki-dark:#[0-9a-fA-F]{6}">function<\/span>/);
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`every token meets WCAG AA contrast in the ${colorScheme} theme`, async ({ browser }) => {
      const page = await browser.newPage({ colorScheme });
      await page.goto("/how-it-works");
      const lowestContrast = await page.evaluate(() => {
        const rgb = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        const luminance = (channels: number[]) =>
          channels
            .map((value) => {
              const fraction = value / 255;
              return fraction <= 0.03928 ? fraction / 12.92 : ((fraction + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        const contrast = (first: string, second: string) => {
          const [lighter, darker] = [luminance(rgb(first)), luminance(rgb(second))].sort((a, b) => b - a);
          return (lighter + 0.05) / (darker + 0.05);
        };
        // The blocks are transparent, so tokens sit on the page background.
        const background = getComputedStyle(document.body).backgroundColor;
        const tokens = [...document.querySelectorAll("pre.shiki span[style]")].filter((token) =>
          token.textContent?.trim(),
        );
        return Math.min(...tokens.map((token) => contrast(getComputedStyle(token).color, background)));
      });
      expect(lowestContrast).toBeGreaterThanOrEqual(4.5);
      await page.close();
    });
  }
});
