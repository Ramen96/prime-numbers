import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const APP_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Tests tagged @slow (e.g. sieving near 2^64) only run with `npm run test:e2e:slow`.
  grepInvert: process.env.RUN_SLOW_TESTS ? undefined : /@slow/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: APP_URL,
    trace: "retain-on-failure",
    // Every test starts with the storage notice already seen, so it never gets in
    // the way. Tests of the notice itself opt out (storageNotice.spec.ts).
    storageState: {
      cookies: [],
      origins: [
        {
          origin: APP_URL,
          localStorage: [{ name: "everyPrimeNumber.storageNoticeSeen", value: "yes" }],
        },
      ],
    },
  },
  // Every test runs at both sizes.
  projects: [
    {
      name: "phone",
      use: { ...devices["Desktop Chrome"], viewport: { width: 420, height: 800 } },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: APP_URL,
    // Locally, reuse a dev server that's already running instead of failing on the port.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
