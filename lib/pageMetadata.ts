import type { Metadata } from "next";
import { SITE_NAME } from "./site";

/**
 * The share image, in /public. Set here rather than through Next's
 * opengraph-image file convention: each page sets its own openGraph and
 * twitter objects, and those replace a convention image instead of merging.
 */
const SHARE_IMAGE = {
  url: "/share-image.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "Every Prime Number: an infinite list of primes, calculated live in your browser.",
};

interface PageMetadataOptions {
  title: string;
  description: string;
  /** Path from the site root, e.g. "/about". */
  path: string;
}

/**
 * Title, description, canonical URL, Open Graph and Twitter tags for one page.
 * Next.js replaces (rather than merges) a parent layout's `openGraph` and
 * `twitter` objects, so each page sets them in full.
 */
export function pageMetadata({ title, description, path }: PageMetadataOptions): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: path,
      siteName: SITE_NAME,
      title,
      description,
      images: [SHARE_IMAGE],
    },
    twitter: { card: "summary_large_image", title, description, images: [SHARE_IMAGE] },
  };
}
