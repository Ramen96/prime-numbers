import { expect, test, type APIRequestContext } from "@playwright/test";

const PAGE_PATHS = ["/", "/how-it-works", "/about"];

/** Requests a URL from the HTML against the local server, even if it's absolute (production domain). */
async function expectReachable(request: APIRequestContext, urlFromHtml: string) {
  const { pathname, search } = new URL(urlFromHtml, "http://placeholder.invalid");
  const response = await request.get(pathname + search);
  expect(response.status(), `${urlFromHtml} should load`).toBe(200);
}

function attributeValues(html: string, tagPattern: RegExp, attribute: string): string[] {
  return [...html.matchAll(tagPattern)].map((tagMatch) => {
    const valueMatch = tagMatch[0].match(new RegExp(`${attribute}="([^"]+)"`));
    return valueMatch![1];
  });
}

test.describe("favicons and share image", () => {
  for (const pagePath of PAGE_PATHS) {
    test(`${pagePath} links favicons, manifest and share image, and they all load`, async ({
      request,
    }) => {
      const html = await (await request.get(pagePath)).text();

      const iconUrls = attributeValues(html, /<link[^>]*rel="(icon|apple-touch-icon)"[^>]*>/g, "href");
      expect(iconUrls).toEqual(
        expect.arrayContaining(["/favicon.ico", "/favicon.svg", "/favicon-96x96.png", "/apple-touch-icon.png"]),
      );
      expect(html).toContain('<link rel="manifest" href="/site.webmanifest"/>');
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>');

      const openGraphImages = attributeValues(html, /<meta property="og:image"[^>]*>/g, "content");
      const twitterImages = attributeValues(html, /<meta name="twitter:image"[^>]*>/g, "content");
      expect(openGraphImages).toHaveLength(1);
      expect(twitterImages).toHaveLength(1);
      expect(html).toContain(
        '<meta property="og:image:alt" content="Every Prime Number: an infinite list of primes, calculated live in your browser."/>',
      );

      for (const url of [...iconUrls, "/site.webmanifest", ...openGraphImages, ...twitterImages]) {
        await expectReachable(request, url);
      }
    });
  }

  test("site.webmanifest is valid JSON with the right name, colours and icons", async ({
    request,
  }) => {
    const manifest = JSON.parse(await (await request.get("/site.webmanifest")).text());
    expect(manifest).toMatchObject({
      name: "Every Prime Number",
      short_name: "Primes",
      theme_color: "#0a0a0a",
      background_color: "#0a0a0a",
    });
    expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(["192x192", "512x512"]);
    for (const icon of manifest.icons) await expectReachable(request, icon.src);
  });
});
