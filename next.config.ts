import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Cross-origin isolation. It makes window.crossOriginIsolated true,
        // which gives performance.now() (in the page and the worker) much
        // finer precision for the primes-per-second counter, and enables
        // SharedArrayBuffer, which the threaded sieve (public/sieve-threads/)
        // needs for its shared memory; without it, the single-threaded
        // fallback runs (lib/primes/loadSieve.ts).
        // Trade-off: every subresource must be same-origin or explicitly
        // allow embedding (CORP/CORS). Everything is self-hosted today,
        // including next/font, so nothing is affected.
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
