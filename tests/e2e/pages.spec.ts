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
    ]) {
      expect(html).toContain(`>${heading}</h2>`);
    }
    expect(html).toContain('<math display="block">');
    expect(html).toContain("<msqrt>");
    // the fun facts moved to their own page; the old anchor lands on the link to it
    expect(html).toMatch(/<p id="fun-facts"><a href="\/fun-facts">Fun facts about primes have a page of their own →<\/a><\/p>/);
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
      "Is there a largest number I can jump to?",
      "Will it break my computer?",
    ]) {
      expect(html).toMatch(new RegExp(`<h3[^>]*>${question.replace("?", "\\?")}</h3>`));
    }
    expect(html).toContain('<link rel="canonical" href="https://everyprimenumber.com/about"/>');
  });
});

test.describe("/fun-facts", () => {
  test("is server-rendered with its groups, facts, MathML, Ulam spiral and links", async ({ request }) => {
    const response = await request.get("/fun-facts");
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/<h1[^>]*>Fun facts about prime numbers<\/h1>/);
    expect(html).toContain("<title>Fun facts about prime numbers | Every Prime Number</title>");
    for (const group of ["The basics", "How primes are spread out", "Numbers that fool primality tests", "Record primes, and primes at work", "Patterns", "On this site"])
      expect(html).toContain(`>${group}</h2>`);
    // the moved facts keep their anchors
    for (const id of ["infinitely-many-primes", "ulam-spiral", "prime-number-theorem", "twin-primes", "goldbach-conjecture", "riemann-hypothesis", "mersenne-primes", "rsa-encryption", "why-1-isnt-prime", "prime-free-stretches", "carmichael-numbers", "hidden-in-the-list"])
      expect(html).toContain(`<h3 id="${id}">`);
    expect(html).toContain('<math display="block">');
    expect(html).toMatch(/<svg[^>]*data-testid="ulam-spiral"/);
    for (const href of ["/?jump=18361375334787046697", "/is-prime/561", "/is-prime/3317044064679887385961981", "/is-prime/147573952589676412927", "/random-prime", "/?jump=314159"])
      expect(html).toContain(`href="${href.replace(/&/g, "&amp;")}"`);
  });
});

test.describe("/what-is-a-prime-number", () => {
  test("is server-rendered with its headings, figures, the primes to 100 and the sieve demo", async ({ request }) => {
    const response = await request.get("/what-is-a-prime-number");
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/<h1[^>]*>What is a prime number\?<\/h1>/);
    for (const heading of ["The prime numbers from 1 to 100", "Primes are the building blocks of numbers", "How to find prime numbers: the sieve of Eratosthenes", "How many prime numbers are there?"])
      expect(html).toContain(`>${heading}</h2>`);
    for (const question of ["Is 1 a prime number?", "Is 2 a prime number?", "Is 0 a prime number?", "Can a negative number be prime?"])
      expect(html).toContain(`>${question}</h3>`);
    expect(html).toContain('<title id="dot-rectangles-title">Dots in rectangles</title>');
    expect(html).toContain('<title id="factor-tree-title">A factor tree for 60</title>');
    expect(html).toContain('data-testid="sieve-demo"');
  });

  test("marks the 25 primes to 100, each number linking to its own page", async ({ page }) => {
    await page.goto("/what-is-a-prime-number");
    const grid = page.getByRole("list", { name: "The numbers from 1 to 100, primes marked" });
    await expect(grid.getByRole("link")).toHaveCount(100);
    const primes = grid.getByRole("link", { name: /, prime$/ });
    await expect(primes).toHaveCount(25);
    expect(await primes.allInnerTexts()).toEqual(["2", "3", "5", "7", "11", "13", "17", "19", "23", "29", "31", "37", "41", "43", "47", "53", "59", "61", "67", "71", "73", "79", "83", "89", "97"]);
    await grid.getByRole("link", { name: "91", exact: true }).click();
    await expect(page).toHaveURL(/\/is-prime\/91$/);
  });
});

test("sitemap.xml lists every page", async ({ request }) => {
  const sitemapXml = await (await request.get("/sitemap.xml")).text();
  for (const pageUrl of [
    "https://everyprimenumber.com",
    "https://everyprimenumber.com/how-it-works",
    "https://everyprimenumber.com/about",
    "https://everyprimenumber.com/random-prime",
    "https://everyprimenumber.com/is-prime",
    "https://everyprimenumber.com/fun-facts",
    "https://everyprimenumber.com/what-is-a-prime-number",
  ]) {
    expect(sitemapXml).toContain(`<loc>${pageUrl}</loc>`);
  }
});
