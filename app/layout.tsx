import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./heat.scss";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { SiteNav } from "./components/SiteNav";
import { StorageNotice } from "./components/StorageNotice";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Site-wide defaults. Each page sets its own title, description, canonical
// URL and social tags with pageMetadata().
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_NAME,
  description:
    "An infinite, scrollable list of prime numbers calculated live in your browser.",
  // Files in /public. The share image is set per page in lib/pageMetadata.ts.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        {/* Desktop: sidebar + page, centered together on wide monitors. */}
        <div className="desktop:mx-auto desktop:flex desktop:max-w-[calc(72rem+11rem)]">
          <SiteNav />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
        <StorageNotice />
      </body>
    </html>
  );
}
