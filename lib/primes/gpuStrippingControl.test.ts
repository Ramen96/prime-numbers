import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GpuStrippingControl, type DisposableStripper } from "./gpuStrippingControl.ts";
import type { GpuStrippingStatus } from "./protocol.ts";
import type { ProofSlots, StrippingSetup } from "./proofSlots.ts";
import { LONE_GPU_FROM_BITS, type ProofWork } from "./stripDepth.ts";

const LIST: ProofWork = { kind: "list", bits: 300 };
const LONE_BIG: ProofWork = { kind: "lone", bits: LONE_GPU_FROM_BITS };
const LONE_SMALL: ProofWork = { kind: "lone", bits: LONE_GPU_FROM_BITS - 1 };

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

/** Lets a started GPU worker's promise settle. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("GpuStrippingControl", () => {
  it("doesn't touch the GPU unless asked: the CPU strips", async () => {
    const { slots, record } = standInSlots();
    let created = 0;
    const control = new GpuStrippingControl(slots, async () => (created++, null));
    const sent: GpuStrippingStatus[] = [];
    control.prepare(false, LIST, (status) => sent.push(status));
    await settled();
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
      control.prepare(true, LIST, (status) => sent.push(status));
      await settled();
      control.prepare(true, LIST, (status) => sent.push(status));
      await settled();
      assert.equal(created, 1);
      assert.deepEqual(record.setups, []);
      assert.deepEqual(sent, [{ state: "cpu" }, { state: "unavailable" }], "the CPU while it starts, then unavailable, once");
    }
  });

  it("with a GPU: hands the proof slots a stripper, reports the depth, and goes back to the CPU when not asked", async () => {
    const { slots, record, current } = standInSlots();
    const { stripper } = standInStripper();
    const control = new GpuStrippingControl(slots, async () => stripper);
    const sent: GpuStrippingStatus[] = [];
    control.prepare(true, LIST, (status) => sent.push(status));
    await settled();
    const setup = current()!;
    assert.equal(setup.stripper, stripper);
    assert.equal(setup.externalFromBits, 246, "below 75 digits on the CPU");
    assert.equal(setup.largestPrimeFor(11), 1_000_000);
    assert.equal(setup.largestPrimeFor(16), 10_000_000);
    setup.onStripped!({ orderCount: 40, limbs: 11, largestPrime: 1_000_000, stripMs: 2, waitedMs: 0 });
    assert.equal(setup.largestPrimeFor(11), 1_000_000, "a rule, not a controller: the depth doesn't move");
    control.prepare(true, LIST, (status) => sent.push(status));
    assert.equal(record.setups.length, 1, "set up once");
    control.prepare(false, LIST, (status) => sent.push(status));
    assert.equal(current(), null);
    assert.equal(sent.length, 4);
    assert.deepEqual(sent[0], { state: "cpu" }, "while the GPU worker starts");
    assert.deepEqual(sent[1], { state: "gpu", largestPrime: null, limbStepsPerSecond: null });
    assert.equal(sent[2].state === "gpu" && sent[2].largestPrime, 1_000_000);
    assert.ok(sent[2].state === "gpu" && sent[2].limbStepsPerSecond! > 0);
    assert.deepEqual(sent[3], { state: "cpu" });
  });

  it("doesn't wait for the GPU worker: proofs start on the CPU, and it joins once ready, only if still wanted", async () => {
    for (const stillWanted of [true, false]) {
      const { slots, current } = standInSlots();
      const { stripper } = standInStripper();
      let ready: (stripper: DisposableStripper) => void = () => {};
      const control = new GpuStrippingControl(slots, () => new Promise((resolve) => (ready = resolve)));
      control.prepare(true, LIST, () => {});
      assert.equal(current(), null, "on the CPU at once");
      if (!stillWanted) control.prepare(false, LIST, () => {}); // a newer request that doesn't want it
      ready(stripper);
      await settled();
      assert.equal(current()?.stripper ?? null, stillWanted ? stripper : null);
      assert.deepEqual(control.status().state, stillWanted ? "gpu" : "cpu");
    }
  });

  it("a lone proof below 135 digits doesn't touch the GPU; from 135 digits, and the list, use it", async () => {
    const { slots, current } = standInSlots();
    const { stripper } = standInStripper();
    let created = 0;
    const control = new GpuStrippingControl(slots, async () => (created++, stripper));
    const sent: GpuStrippingStatus[] = [];
    control.prepare(true, LONE_SMALL, (status) => sent.push(status));
    await settled();
    assert.equal(created, 0, "the GPU worker isn't even started");
    assert.equal(current(), null);
    assert.deepEqual(sent, [{ state: "cpu" }]);
    control.prepare(true, LONE_BIG, (status) => sent.push(status));
    await settled();
    assert.equal(current()?.stripper, stripper);
    control.prepare(true, LONE_SMALL, (status) => sent.push(status));
    assert.equal(current(), null, "back to the CPU for a small lone proof, the stripper kept");
    control.prepare(true, LIST, (status) => sent.push(status));
    assert.equal(current()?.stripper, stripper, "the list: the list's rule, whatever its count");
    assert.equal(created, 1);
  });

  it("the switch applies to the request being worked on at once, within the rule", async () => {
    const { slots, current } = standInSlots();
    const { stripper } = standInStripper();
    const control = new GpuStrippingControl(slots, async () => stripper);
    const sent: GpuStrippingStatus[] = [];
    control.prepare(true, LIST, (status) => sent.push(status));
    await settled();
    assert.equal(current()?.stripper, stripper);
    control.setUseGpu(false);
    assert.equal(current(), null, "off: the CPU at once");
    assert.deepEqual(sent.at(-1), { state: "cpu" });
    control.setUseGpu(true);
    assert.equal(current()?.stripper, stripper, "on again");
    control.prepare(true, LONE_SMALL, () => {});
    control.setUseGpu(true);
    assert.equal(current(), null, "on, but the rule still keeps a small lone proof on the CPU");
  });

  it("the list below 75 digits doesn't start the GPU worker", async () => {
    const { slots, current } = standInSlots();
    let created = 0;
    const control = new GpuStrippingControl(slots, async () => (created++, standInStripper().stripper));
    control.prepare(true, { kind: "list", bits: 200 }, () => {});
    await settled();
    assert.equal(created, 0);
    assert.equal(current(), null);
  });

  it("after a failure or a wrong answer: the stripper is thrown away and never used again", async () => {
    const { slots, current } = standInSlots();
    const { stripper, record } = standInStripper();
    let created = 0;
    const control = new GpuStrippingControl(slots, async () => (created++, stripper));
    const sent: GpuStrippingStatus[] = [];
    control.prepare(true, LIST, (status) => sent.push(status));
    await settled();
    const setup = current()!;
    slots.useStripper(null); // what ProofSlots does before onFailure
    setup.onFailure!({ kind: "wrong-factor" });
    assert.equal(record.destroyed, 1);
    control.prepare(true, LIST, (status) => sent.push(status));
    await settled();
    assert.equal(current(), null, "still on the CPU");
    assert.equal(created, 1);
    assert.deepEqual(sent.at(-1), { state: "failed", failure: { kind: "wrong-factor" } });
    assert.deepEqual(control.status(), { state: "failed", failure: { kind: "wrong-factor" } });
  });
});
