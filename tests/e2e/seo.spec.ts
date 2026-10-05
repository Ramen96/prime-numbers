import { expect, test } from "@playwright/test";

const INTRO_TEXT =
  "Every Prime Number is an infinite list of prime numbers, calculated live in your browser.";

// `request` fetches over HTTP without a browser, so nothing here comes from
// JavaScript: it's exactly what a search engine crawler receives.
test.describe("server-rendered HTML", () => {
  test("contains the heading and intro paragraph", async ({ request }) => {
    const response = await request.get("/");
    expect(response.ok()).toBe(true);
    const html = await response.text();

    expect(html).toMatch(/<h1[^>]*>Every Prime Number<\/h1>/);
    expect(html).toContain(INTRO_TEXT);
    expect(html).toContain("watch the primes-per-second counter fall");
  });

  test("contains the title, description, Open Graph and Twitter tags", async ({ request }) => {
    const html = await (await request.get("/")).text();
    const title = "Every Prime Number – An Infinite List of Primes, Calculated Live";

    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toMatch(/<meta name="description" content="An infinite, scrollable list of prime numbers/);
    expect(html).toContain(`<meta property="og:title" content="${title}"/>`);
    expect(html).toContain('<meta property="og:url" content="https://everyprimenumber.com"/>');
    expect(html).toContain('<meta name="twitter:card" content="summary"/>');
    expect(html).toContain(`<meta name="twitter:title" content="${title}"/>`);
  });

  test("robots.txt allows everything and points to the sitemap", async ({ request }) => {
    const robotsTxt = await (await request.get("/robots.txt")).text();
    expect(robotsTxt).toContain("Allow: /");
    expect(robotsTxt).toContain("Sitemap: https://everyprimenumber.com/sitemap.xml");

    const sitemapXml = await (await request.get("/sitemap.xml")).text();
    expect(sitemapXml).toContain("<loc>https://everyprimenumber.com</loc>");
  });
});
