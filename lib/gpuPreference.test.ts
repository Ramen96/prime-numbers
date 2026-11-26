import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startsWithGpuOff } from "./gpuPreference.ts";

describe("startsWithGpuOff", () => {
  it("is Firefox (Gecko) on every desktop and Android", () => {
    for (const userAgent of [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:150.0) Gecko/20100101 Firefox/150.0",
      "Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0",
      "Mozilla/5.0 (Android 15; Mobile; rv:150.0) Gecko/150.0 Firefox/150.0",
    ])
      assert.equal(startsWithGpuOff(userAgent), true, userAgent);
  });

  it("isn't Chrome, Edge, Safari, or Firefox on iOS (which runs on WebKit)", () => {
    for (const userAgent of [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36 Edg/158.0.0.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/150.0 Mobile/15E148 Safari/605.1.15",
      "",
    ])
      assert.equal(startsWithGpuOff(userAgent), false, userAgent);
  });
});
