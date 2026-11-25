import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeGpuRow } from "./gpuRow.ts";

describe("the home page's GPU row", () => {
  it("is disabled until the page knows, and where there's no WebGPU, page or worker", () => {
    assert.deepEqual(describeGpuRow(true, null, null), { text: "—", checked: false, disabled: true });
    assert.deepEqual(describeGpuRow(true, false, null), { text: "not available here", checked: false, disabled: true });
    assert.deepEqual(describeGpuRow(true, true, { state: "unavailable" }), { text: "not available here", checked: false, disabled: true });
  });

  it("on by default: waiting for 75 digits, then helping; off means the CPU only", () => {
    assert.deepEqual(describeGpuRow(true, true, null), { text: "on, used from 75 digits", checked: true, disabled: false });
    assert.equal(describeGpuRow(true, true, { state: "cpu" }).text, "on, used from 75 digits");
    assert.equal(describeGpuRow(true, true, { state: "gpu", largestPrime: null, limbStepsPerSecond: null }).text, "on, helping");
    assert.deepEqual(describeGpuRow(false, true, { state: "gpu", largestPrime: 1e6, limbStepsPerSecond: 1 }), {
      text: "off, CPU only",
      checked: false,
      disabled: false,
    });
  });

  it("says when the GPU was dropped, whatever the switch says", () => {
    assert.equal(describeGpuRow(true, true, { state: "failed", failure: { kind: "error", message: "lost" } }).text, "stopped after an error");
    for (const failure of [{ kind: "wrong-factor" }, { kind: "missed-factor", prime: 7 }] as const) {
      assert.equal(describeGpuRow(false, true, { state: "failed", failure }).text, "stopped after a wrong answer");
    }
  });
});
