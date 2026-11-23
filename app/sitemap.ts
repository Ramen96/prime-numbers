import type { MetadataRoute } from "next";
import { listedNumbers } from "@/lib/listedNumbers";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/how-it-works`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/about`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${SITE_URL}/random-prime`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/is-prime`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/fun-facts`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/what-is-a-prime-number`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/how-to-tell-if-a-number-is-prime`, changeFrequency: "monthly", priority: 0.7 },
    // each listed number's own page: its answer never changes
    ...listedNumbers().map(({ value }) => ({ url: `${SITE_URL}/is-prime/${value}`, changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
