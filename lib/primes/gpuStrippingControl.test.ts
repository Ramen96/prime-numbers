import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GpuStrippingControl, type DisposableStripper } from "./gpuStrippingControl.ts";
import type { GpuStrippingStatus } from "./protocol.ts";
import type { ProofSlots, StrippingSetup } from "./proofSlots.ts";

/** The two ProofSlots methods the control uses, recording what they're given. */
function standInSlots() {
  const record = { setups: [] as (StrippingSetup | null)[] };
  let current: StrippingSetup | null = null;
  const slots = {
    stripping: () => current !== null,
    useStripper: (setup: StrippingSetup | null) => {
      current = setup;
      record.setups.push(setup);
    },
  };
  return { slots: slots as unknown as ProofSlots, record, current: () => current };
}

function standInStripper() {
  const record = { destroyed: 0 };
  const stripper: DisposableStripper = { strip: async () => [], destroy: () => void record.destroyed++ };
  return { stripper, record };
}

describe("GpuStrippingControl", () => {
  it("doesn't touch the GPU unless asked: the CPU strips", async () => {
    const { slots, record } = standInSlots();
    let created = 0;
    const control = new GpuStrippingControl(slots, async () => (created++, null));
    const sent: GpuStrippingStatus[] = [];
    await control.prepare(false, (status) => sent.push(status));
    assert.equal(created, 0);
    assert.deepEqual(record.setups, []);
    assert.deepEqual(sent, [{ state: "cpu" }]);
  });

  it("without WebGPU (or if making the stripper throws): unavailable, and it's tried only once", async () => {
    for (const create of [async () => null, async () => Promise.reject(new Error("no"))]) {
      const { slots, record } = standInSlots();
      let created = 0;
      const control = new GpuStrippingControl(slots, () => (created++, create()));
      const sent: GpuStrippingStatus[] = [];
      await control.prepare(true, (status) => sent.push(status));
      await control.prepare(true, (status) => sent.push(status));
      assert.equal(created, 1);
      assert.deepEqual(record.setups, []);
      assert.deepEqual(sent, [{ state: "unavailable" }], "sent once: it didn't change");
    }
  });

  it("with a GPU: hands the proof slots a stripper, reports the depth, and goes back to the CPU when not asked", async () => {
    const { slots, record, current } = standInSlots();
    const { stripper } = standInStripper();
    const control = new GpuStrippingControl(slots, async () => stripper);
    const sent: GpuStrippingStatus[] = [];
    await control.prepare(true, (status) => sent.push(status));
    const setup = current()!;
    assert.equal(setup.stripper, stripper);
    assert.equal(setup.largestPrimeFor(11), 100_000);
    setup.onStripped!({ orderCount: 40, limbs: 11, largestPrime: 100_000, stripMs: 2, waitedMs: 0 });
    assert.equal(setup.largestPrimeFor(11), 316_228, "the controller moved deeper");
    await control.prepare(true, (status) => sent.push(status));
    assert.equal(record.setups.length, 1, "set up once");
    await control.prepare(false, (status) => sent.push(status));
    assert.equal(current(), null);
    assert.equal(sent.length, 3);
    assert.deepEqual(sent[0], { state: "gpu", largestPrime: null, limbStepsPerSecond: null });
    assert.equal(sent[1].state, "gpu");
    assert.equal(sent[1].state === "gpu" && sent[1].largestPrime, 100_000);
    assert.ok(sent[1].state === "gpu" && sent[1].limbStepsPerSecond! > 0);
    assert.deepEqual(sent[2], { state: "cpu" });
  });

  it("after a failure or a wrong answer: the stripper is thrown away and never used again", async () => {
    const { slots, current } = standInSlots();
    const { stripper, record } = standInStripper();
    let created = 0;
    const control = new GpuStrippingControl(slots, async () => (created++, stripper));
    const sent: GpuStrippingStatus[] = [];
    await control.prepare(true, (status) => sent.push(status));
    const setup = current()!;
    slots.useStripper(null); // what ProofSlots does before onFailure
    setup.onFailure!({ kind: "wrong-factor" });
    assert.equal(record.destroyed, 1);
    await control.prepare(true, (status) => sent.push(status));
    assert.equal(current(), null, "still on the CPU");
    assert.equal(created, 1);
    assert.deepEqual(sent.at(-1), { state: "failed", failure: { kind: "wrong-factor" } });
    assert.deepEqual(control.status(), { state: "failed", failure: { kind: "wrong-factor" } });
  });
});
