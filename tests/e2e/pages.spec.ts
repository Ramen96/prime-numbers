import { expect, test } from "@playwright/test";

// Fetched over HTTP without a browser: exactly what a crawler that doesn't
// run JavaScript receives.
test.describe("/how-it-works", () => {
  test("is server-rendered with its headings, MathML and Ulam spiral", async ({ request }) => {
    const response = await request.get("/how-it-works");
    expect(response.status()).toBe(200);
    const html = await response.text();

    expect(html).toMatch(/<h1[^>]*>How Every Prime Number works<\/h1>/);
    for (const heading of [
      "Why you only need to check divisors up to √n",
      "How the segmented sieve of Eratosthenes works",
      "How an infinite scroll can use constant memory",
      "Computing li(x) with Ramanujan’s series",
      "What is the largest number JavaScript can store exactly?",
      "Fun facts about prime numbers",
    ]) {
      expect(html).toContain(`>${heading}</h2>`);
    }
    expect(html).toContain('<math display="block">');
    expect(html).toContain("<msqrt>");
    expect(html).toMatch(/<svg[^>]*data-testid="ulam-spiral"/);
    expect(html).toContain("<title id=\"ulam-spiral-title\">Ulam spiral of the numbers 1 to 14,641</title>");
    expect(html).toContain('<link rel="canonical" href="https://everyprimenumber.com/how-it-works"/>');
    expect(html).toContain('<meta property="og:url" content="https://everyprimenumber.com/how-it-works"/>');
  });
});

test.describe("/about", () => {
  test("is server-rendered with its heading and FAQ", async ({ request }) => {
    const response = await request.get("/about");
    expect(response.status()).toBe(200);
    const html = await response.text();

    expect(html).toMatch(/<h1[^>]*>About Every Prime Number<\/h1>/);
    expect(html).toContain(">Frequently asked questions</h2>");
    for (const question of [
      "Does it really calculate every prime number?",
      "Is it using my computer?",
      "Is any of my data sent anywhere?",
      "Why does the counter slow down as I scroll?",
      "What does the “≈” next to a number mean?",
      "Why can’t I jump past a certain number?",
      "Will it break my computer?",
    ]) {
      expect(html).toMatch(new RegExp(`<h3[^>]*>${question.replace("?", "\\?")}</h3>`));
    }
    expect(html).toContain('<link rel="canonical" href="https://everyprimenumber.com/about"/>');
  });
});

test("sitemap.xml lists every page", async ({ request }) => {
  const sitemapXml = await (await request.get("/sitemap.xml")).text();
  for (const pageUrl of [
    "https://everyprimenumber.com",
    "https://everyprimenumber.com/how-it-works",
    "https://everyprimenumber.com/about",
  ]) {
    expect(sitemapXml).toContain(`<loc>${pageUrl}</loc>`);
  }
});
