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
      "Why does the GPU switch say “not available here”?",
      "My computer has a gaming GPU. Is the site using it?",
    ]) {
      expect(html).toMatch(new RegExp(`<h3[^>]*>${question.replace("?", "\\?")}</h3>`));
    }
    expect(html).toMatch(/<h3[^>]*id="why-does-the-gpu-switch-say-not-available-here"/);
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

test.describe("/how-to-tell-if-a-number-is-prime", () => {
  test("is server-rendered with its headings, rules, figure, questions and the demo's first answer", async ({ request }) => {
    const response = await request.get("/how-to-tell-if-a-number-is-prime");
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/<h1[^>]*>How to tell if a number is prime<\/h1>/);
    for (const heading of ["Quick checks first: divisibility rules", "Trial division, and why you can stop at the square root", "Try it", "Worked examples", "Why big numbers need something cleverer", "Common questions"])
      expect(html).toContain(`>${heading}</h2>`);
    for (const question of ["Is there a formula that gives every prime?", "Is a number ending in 1, 3, 7 or 9 always prime?", "Do I need to try dividing by 4, 6, 8 or 9?", "How are the largest known primes found?"])
      expect(html).toContain(`>${question}</h3>`);
    for (const example of ["358 ends in 8", "51: 5 + 1 = 6", "203: 20 − 2 × 3 = 14", "1,001: 1 − 0 + 0 − 1 = 0"]) expect(html).toContain(`<td>${example}</td>`);
    expect(html).toContain('<title id="factor-pairs-title">The factor pairs of 36</title>');
    // the demo is built with 97's answer
    expect(html).toContain("97 ÷ 7 = 13, remainder 6");
    expect(html).toMatch(/None of the primes up to √97 ≈ 9.8 divides it, so <a href="\/is-prime\/97">97<\/a> is prime./);
  });

  test("the demo divides by each prime up to the square root, and stops at a factor", async ({ page }) => {
    await page.goto("/how-to-tell-if-a-number-is-prime");
    const demo = page.getByTestId("trial-division-demo");
    const field = demo.getByRole("textbox", { name: "A number from 2 to 10,000" });
    const divide = demo.getByRole("button", { name: "Divide" });
    const steps = demo.getByTestId("trial-division-steps").getByRole("listitem");
    const result = demo.getByRole("status");
    expect((await divide.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await field.fill("91");
    await divide.click();
    await expect(steps).toHaveText(["91 ÷ 2 = 45, remainder 1", "91 ÷ 3 = 30, remainder 1", "91 ÷ 5 = 18, remainder 1", "91 ÷ 7 = 13, remainder 0"]);
    await expect(steps.last()).toHaveAttribute("data-divides", "true");
    await expect(result).toHaveText("7 divides 91 evenly: 91 = 7 × 13, so 91 isn’t prime.");

    await field.fill("9,973"); // the largest prime below 10,000: all 25 primes below 100
    await divide.click();
    await expect(steps).toHaveCount(25);
    await expect(result).toHaveText("None of the primes up to √9,973 ≈ 99.8 divides it, so 9,973 is prime.");
    await expect(result.getByRole("link", { name: "9,973" })).toHaveAttribute("href", "/is-prime?n=9973"); // not a listed number

    await field.fill("3");
    await divide.click();
    await expect(steps).toHaveCount(0);
    await expect(result).toHaveText("No prime is at or below √3 ≈ 1.7, so there’s nothing to try: 3 is prime.");

    await field.fill("-7");
    await divide.click();
    await expect(result).toHaveText("Type a whole number, like 97.");
    await expect(field).toHaveAttribute("aria-invalid", "true");

    await field.fill("10001");
    await divide.click();
    await expect(result).toHaveText("That’s more than this demo divides. Check it with the prime checker →");
    await result.getByRole("link", { name: "Check it with the prime checker →" }).click();
    await expect(page).toHaveURL(/\/is-prime\?n=10001$/);
    await expect(page.getByTestId("prime-check-headline")).toHaveText("10,001 isn’t prime: it’s divisible by 73.", { timeout: 15_000 });
  });

  test("a listed number in the demo's answer opens its own page", async ({ page }) => {
    await page.goto("/how-to-tell-if-a-number-is-prime");
    const demo = page.getByTestId("trial-division-demo");
    await demo.getByRole("textbox").fill("221");
    await demo.getByRole("button", { name: "Divide" }).click();
    await demo.getByRole("status").getByRole("link", { name: "221" }).click();
    await expect(page).toHaveURL(/\/is-prime\/221$/);
  });
});

test.describe("/mersenne-primes", () => {
  test("is server-rendered with its headings, table, questions and the demo's first answer", async ({ request }) => {
    const response = await request.get("/mersenne-primes");
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/<h1[^>]*>What is a Mersenne prime\?<\/h1>/);
    for (const heading of ["Powers of two, minus one", "The Lucas–Lehmer test", "A short history", "The largest known prime", "Perfect numbers", "Common questions"])
      expect(html).toContain(`>${heading}</h2>`);
    for (const question of ["Are there infinitely many Mersenne primes?", "Is 2ᵖ − 1 prime whenever p is prime?", "Can I help find the next one?"])
      expect(html).toContain(`>${question}</h3>`);
    for (const factors of ["23 × 89", "47 × 178,481", "233 × 1,103 × 2,089"]) expect(html).toContain(`<td>${factors}</td>`);
    expect(html).toContain('href="/is-prime/2047"');
    expect(html).toContain('href="/is-prime?n=8191"');
    expect(html).toContain(`href="/?jump=${2n ** 127n - 1n}"`);
    // the demo is built with p = 7's answer
    expect(html).toContain("s₅ = (111² − 2) mod 127 = 0");
    expect(html).toContain("After 5 steps the remainder is 0, so 2⁷ − 1 = 127 is prime.");
  });

  test("the table marks the eight Mersenne primes up to 2³¹ − 1", async ({ page }) => {
    await page.goto("/mersenne-primes");
    const rows = page.getByTestId("mersenne-table").locator("tbody tr");
    await expect(rows).toHaveCount(11);
    await expect(rows.filter({ hasText: "prime" })).toHaveCount(8); // 2 to 31, all but 11, 23 and 29
  });

  test("the demo runs the Lucas–Lehmer test for the chosen exponent", async ({ page }) => {
    await page.goto("/mersenne-primes");
    const demo = page.getByTestId("lucas-lehmer-demo");
    const exponent = demo.getByRole("combobox", { name: "The exponent p" });
    const terms = demo.getByTestId("lucas-lehmer-terms").getByRole("listitem");
    const result = demo.getByRole("status");
    expect((await exponent.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(terms).toHaveCount(6);

    await exponent.selectOption("11");
    await expect(terms).toHaveCount(10);
    await expect(terms.last()).toHaveText("s₉ = (282² − 2) mod 2,047 = 1,736");
    await expect(result).toHaveText(
      "After 9 steps the remainder is 1,736, not 0, so 2¹¹ − 1 = 2,047 isn’t prime. The test doesn’t say what its factors are: they’re 23 × 89.",
    );

    await exponent.selectOption("31");
    await expect(terms).toHaveCount(30);
    await expect(result).toHaveText("After 29 steps the remainder is 0, so 2³¹ − 1 = 2,147,483,647 is prime.");

    await exponent.selectOption("3");
    await expect(result).toHaveText("After 1 step the remainder is 0, so 2³ − 1 = 7 is prime.");
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
    "https://everyprimenumber.com/how-to-tell-if-a-number-is-prime",
    "https://everyprimenumber.com/mersenne-primes",
  ]) {
    expect(sitemapXml).toContain(`<loc>${pageUrl}</loc>`);
  }
});
