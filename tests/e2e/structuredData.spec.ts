import { expect, test } from "@playwright/test";

function jsonLdBlocks(html: string): Array<Record<string, unknown>> {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    ([, json]) => JSON.parse(json),
  );
}

test.describe("structured data (JSON-LD)", () => {
  test("home has WebSite and WebApplication", async ({ request }) => {
    const blocks = jsonLdBlocks(await (await request.get("/")).text());
    expect(blocks.map((block) => block["@type"])).toEqual(["WebSite", "WebApplication"]);
    expect(blocks[0]).toMatchObject({ name: "Every Prime Number", url: "https://everyprimenumber.com" });
    expect(blocks[1]).toMatchObject({
      applicationCategory: "EducationalApplication",
      operatingSystem: "Any",
      offers: { "@type": "Offer", price: "0" },
    });
  });

  test("/how-it-works has a TechArticle", async ({ request }) => {
    const blocks = jsonLdBlocks(await (await request.get("/how-it-works")).text());
    expect(blocks.map((block) => block["@type"])).toEqual(["TechArticle"]);
    expect(blocks[0]).toMatchObject({
      headline: "How Every Prime Number works",
      url: "https://everyprimenumber.com/how-it-works",
      author: { "@type": "Person" },
    });
  });
});
