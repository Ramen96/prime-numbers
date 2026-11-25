import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSoftwareAdapter, requestHardwareAdapter } from "./gpuAdapter.ts";

/** As Chromium 158 reports them (headless with --enable-unsafe-webgpu, and headed on an Apple M4). */
const SWIFTSHADER = { vendor: "google", architecture: "swiftshader", device: "", description: "", isFallbackAdapter: true };
const APPLE_METAL = { vendor: "apple", architecture: "metal-3", device: "", description: "", isFallbackAdapter: false };

describe("isSoftwareAdapter", () => {
  it("takes SwiftShader for software and Apple's Metal for hardware", () => {
    assert.equal(isSoftwareAdapter({ info: SWIFTSHADER }), true);
    assert.equal(isSoftwareAdapter({ info: APPLE_METAL }), false);
  });

  it("goes by the fallback flag, on the info or (in older browsers) the adapter", () => {
    assert.equal(isSoftwareAdapter({ info: { ...APPLE_METAL, isFallbackAdapter: true } }), true);
    assert.equal(isSoftwareAdapter({ info: { vendor: "apple", architecture: "metal-3" }, isFallbackAdapter: true }), true);
  });

  it("goes by the name too, when the flag doesn't say so, in any field and any case", () => {
    assert.equal(isSoftwareAdapter({ info: { ...SWIFTSHADER, isFallbackAdapter: false } }), true);
    assert.equal(isSoftwareAdapter({ info: { vendor: "mesa", architecture: "", device: "llvmpipe (LLVM 17.0.6, 256 bits)", description: "" } }), true);
    assert.equal(isSoftwareAdapter({ info: { vendor: "", architecture: "", device: "", description: "Microsoft Basic Render Driver" } }), true);
    assert.equal(isSoftwareAdapter({ info: { vendor: "mesa", description: "Lavapipe" } }), true);
  });

  it("takes an adapter that names nothing for hardware", () => {
    assert.equal(isSoftwareAdapter({ info: { vendor: "", architecture: "", device: "", description: "", isFallbackAdapter: false } }), false);
    assert.equal(isSoftwareAdapter({}), false);
    assert.equal(isSoftwareAdapter({ info: { vendor: "nvidia", architecture: "ampere" } }), false);
  });
});

describe("requestHardwareAdapter", () => {
  const gpuGiving = (info: object | null) => ({ requestAdapter: async () => (info ? { info } : null) }) as unknown as GPU;

  it("gives a hardware adapter, and null for a software one, none, or no WebGPU", async () => {
    assert.deepEqual(await requestHardwareAdapter(gpuGiving(APPLE_METAL)), { info: APPLE_METAL });
    assert.equal(await requestHardwareAdapter(gpuGiving(SWIFTSHADER)), null);
    assert.equal(await requestHardwareAdapter(gpuGiving(null)), null);
    assert.equal(await requestHardwareAdapter(undefined), null);
  });
});
