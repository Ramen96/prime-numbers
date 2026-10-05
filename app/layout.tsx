import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_TITLE = "Every Prime Number – An Infinite List of Primes, Calculated Live";
const SITE_DESCRIPTION =
  "An infinite, scrollable list of prime numbers calculated live in your browser. Jump to any number and watch your CPU work harder as the primes get bigger.";

export const metadata: Metadata = {
  metadataBase: new URL("https://everyprimenumber.com"),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Every Prime Number",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    // "summary" rather than "summary_large_image" until there's a share image.
    card: "summary",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
