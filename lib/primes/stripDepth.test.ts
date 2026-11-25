import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEEP_GPU_DEPTH,
  DEEPEST_FROM_LIMBS,
  GPU_STRIPPING_FROM_BITS,
  gpuStripDepth,
  gpuStripsFor,
  LONE_GPU_FROM_BITS,
  SHALLOW_GPU_DEPTH,
} from "./stripDepth.ts";

const digitsOfBits = (bits: number) => Math.ceil(bits * Math.log10(2));

describe("the GPU's stripping rule", () => {
  it("leaves numbers below 75 digits to the CPU", () => {
    assert.equal(digitsOfBits(GPU_STRIPPING_FROM_BITS), 75);
    assert.equal(digitsOfBits(GPU_STRIPPING_FROM_BITS - 1), 74);
  });

  it("strips to 10^6 below about 145 digits (16 limbs) and to 10^7 from there", () => {
    assert.equal(gpuStripDepth(8), SHALLOW_GPU_DEPTH);
    assert.equal(gpuStripDepth(DEEPEST_FROM_LIMBS - 1), 1_000_000);
    assert.equal(gpuStripDepth(DEEPEST_FROM_LIMBS), 10_000_000);
    assert.equal(gpuStripDepth(1_000), DEEP_GPU_DEPTH);
    assert.equal(digitsOfBits(32 * (DEEPEST_FROM_LIMBS - 1) + 1), 145);
  });

  it("strips for the list at any size, and for a lone proof only from 135 digits", () => {
    assert.equal(digitsOfBits(LONE_GPU_FROM_BITS), 135);
    assert.equal(digitsOfBits(LONE_GPU_FROM_BITS - 1), 134);
    assert.equal(gpuStripsFor({ kind: "list" }), true);
    assert.equal(gpuStripsFor({ kind: "lone", bits: LONE_GPU_FROM_BITS - 1 }), false);
    assert.equal(gpuStripsFor({ kind: "lone", bits: LONE_GPU_FROM_BITS }), true);
    assert.equal((10n ** 134n).toString(2).length, LONE_GPU_FROM_BITS, "the smallest 135-digit number has 446 bits");
  });

  it("is never shallower than the CPU's own bound (10^5, or 10^6 from 26 limbs)", () => {
    for (let limbs = 1; limbs <= 200; limbs++) assert.ok(gpuStripDepth(limbs) >= (limbs >= 26 ? 1_000_000 : 100_000));
  });
});
