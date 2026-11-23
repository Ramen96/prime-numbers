import { ImageResponse } from "next/og";
import { shortNumber } from "@/lib/certificateCheck";
import { listedAnswers } from "@/lib/listedAnswers";
import { listedNumbers } from "@/lib/listedNumbers";
import { listedCardAnswer } from "@/lib/primeCheck";

// A listed number's link preview card (1200 × 630), built ahead of time with
// its page. Styled like the site's share image (design/share-image.svg): the
// dark background, the heat-gradient spiral, Geist (next/og's own font).

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamicParams = false;

export function generateStaticParams() {
  return listedNumbers().map(({ value }) => ({ n: String(value) }));
}

/** Smaller type for longer numbers, so the shortened number stays on one line. */
function numberFontSize(shown: string): number {
  if (shown.length <= 9) return 150;
  if (shown.length <= 16) return 110;
  if (shown.length <= 24) return 78;
  return 60;
}

export default async function Image({ params }: { params: Promise<{ n: string }> }) {
  const { n } = await params;
  const value = BigInt(n);
  const answer = listedAnswers().get(value)!;
  const shown = shortNumber(value);
  const prime = answer.kind === "prime";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#0a0a0a", color: "#ededed", padding: "64px 72px" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <svg width="64" height="64" viewBox="96 76 320 360">
              <defs>
                <radialGradient id="heat" gradientUnits="userSpaceOnUse" cx="256" cy="256" r="236">
                  <stop offset="0" stopColor="#4aa3ff" />
                  <stop offset="0.38" stopColor="#9a7cff" />
                  <stop offset="0.62" stopColor="#ff6aa8" />
                  <stop offset="0.82" stopColor="#ff9a3c" />
                  <stop offset="1" stopColor="#ff2d2d" />
                </radialGradient>
              </defs>
              <path
                d="M216 276 V196 H296 V356 H136 V116 H376 V396"
                fill="none"
                stroke="url(#heat)"
                strokeWidth="56"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div style={{ fontSize: 36, color: "#a1a1a1" }}>Is it prime?</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: numberFontSize(shown), letterSpacing: -2, lineHeight: 1.1 }}>{shown}</div>
            <div style={{ fontSize: 56, color: prime ? "#ff9a3c" : "#ededed" }}>{listedCardAnswer(answer)}</div>
          </div>
          <div style={{ fontSize: 30, color: "#a1a1a1" }}>everyprimenumber.com</div>
        </div>
      </div>
    ),
    size,
  );
}
