import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProofSlots, type RawProofSlotExports } from "./proofSlots.ts";

/**
 * A stand-in for proof_slots.c: `slots` slots, each "proving" its candidate in
 * runsNeeded(candidate) runs, then holding a one-step certificate whose values
 * are the candidate and small multiples of it (some past 2^32, to need several
 * limbs). outOfMemoryFor makes a candidate's slot run out of memory instead, once
 * its runs are used up, so later candidates can finish before it.
 * It lays values out in a real WebAssembly.Memory, as limbs, like the C does.
 */
function standInSlots(
  slots: number,
  runsNeeded: (candidate: bigint) => number,
  outOfMemoryFor: (candidate: bigint) => boolean = () => false,
) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const inputPointer = 1024;
  const outputPointer = 8192;
  const states = new Array(slots).fill(0);
  const candidates: (bigint | null)[] = new Array(slots).fill(null);
  const runsLeft = new Array(slots).fill(0);
  const log = { runs: 0, starts: [] as bigint[], mostBusyAtOnce: 0 };
  const readInput = (limbCount: number) => {
    const limbs = new Uint32Array(memory.buffer, inputPointer, limbCount);
    let value = 0n;
    for (let index = limbCount - 1; index >= 0; index--) value = (value << 32n) | BigInt(limbs[index]);
    return value;
  };
  const raw: RawProofSlotExports = {
    memory,
    proof_slot_count: () => slots,
    proof_input_buffer: () => inputPointer,
    proof_slot_start: (slot, limbCount) => {
      const candidate = readInput(limbCount);
      candidates[slot] = candidate;
      runsLeft[slot] = runsNeeded(candidate);
      states[slot] = 1;
      log.starts.push(candidate);
      return 1;
    },
    proof_slots_run: () => {
      log.runs++;
      log.mostBusyAtOnce = Math.max(log.mostBusyAtOnce, states.filter((state) => state === 1).length);
      for (let slot = 0; slot < slots; slot++) {
        if (states[slot] !== 1) continue;
        if (--runsLeft[slot] <= 0) states[slot] = outOfMemoryFor(candidates[slot]!) ? 3 : 2;
      }
      return states.filter((state) => state === 1 || state === 3).length;
    },
    proof_slot_state_of: (slot) => states[slot],
    proof_slot_step_count: (slot) => (states[slot] === 2 ? 1 : 0),
    proof_slot_value: (slot, _step, field) => {
      const value = candidates[slot]! * BigInt(field + 1) * 2n ** 40n;
      const limbs: number[] = [];
      for (let rest = value; rest > 0n; rest >>= 32n) limbs.push(Number(rest & 0xffff_ffffn));
      new Uint32Array(memory.buffer, outputPointer, limbs.length).set(limbs);
      return limbs.length;
    },
    proof_output_buffer: () => outputPointer,
    proof_slot_clear: (slot) => {
      states[slot] = 0;
      candidates[slot] = null;
    },
  };
  return { raw, log };
}

const certificateOf = (candidate: bigint) => [
  {
    number: candidate * 2n ** 40n,
    curveA: candidate * 2n * 2n ** 40n,
    curveB: candidate * 3n * 2n ** 40n,
    pointX: candidate * 4n * 2n ** 40n,
    pointY: candidate * 5n * 2n ** 40n,
    orderPrime: candidate * 6n * 2n ** 40n,
  },
];

describe("ProofSlots", () => {
  it("returns every certificate in the candidates' order, whichever finishes first", async () => {
    const candidates = [11n, 13n, 17n, 19n, 23n, 29n, 31n];
    // later candidates finish sooner, so slots finish out of order
    const { raw } = standInSlots(3, (candidate) => Number(40n - candidate));
    const result = await new ProofSlots(raw).proveInOrder(candidates, { workPerRun: 1 });
    assert.equal(result.outOfMemory, false);
    assert.deepEqual(result.certificates, candidates.map(certificateOf));
  });

  it("keeps every slot busy: a finished slot takes the next candidate at once", async () => {
    const candidates = Array.from({ length: 12 }, (_, index) => BigInt(101 + 2 * index));
    const { raw, log } = standInSlots(4, (candidate) => (candidate % 3n === 0n ? 9 : 1));
    await new ProofSlots(raw).proveInOrder(candidates);
    assert.equal(log.mostBusyAtOnce, 4);
    assert.deepEqual(log.starts, candidates, "each started once, in order");
    // a slow candidate doesn't hold up the others: proving in groups of 4, each
    // waiting for its slowest (9 runs), would take 3 × 9 = 27 runs
    assert.ok(log.runs < 27, `${log.runs} runs`);
  });

  it("stops at the first candidate memory runs out on, keeping only what came before it", async () => {
    // 17 runs out of memory after 3 runs, while 19, 23 and 29 finish sooner
    const candidates = [11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
    const { raw, log } = standInSlots(2, (candidate) => (candidate === 17n ? 3 : 1), (candidate) => candidate === 17n);
    const result = await new ProofSlots(raw).proveInOrder(candidates, { workPerRun: 1 });
    assert.equal(result.outOfMemory, true);
    assert.deepEqual(result.certificates, [11n, 13n].map(certificateOf), "nothing after it, even what finished first");
    assert.ok(!log.starts.includes(37n), "nothing more is started once it's known");
  });

  it("gives control back between runs", async () => {
    const { raw, log } = standInSlots(2, () => 5);
    let calls = 0;
    await new ProofSlots(raw).proveInOrder([11n, 13n], { betweenRuns: () => void calls++ });
    assert.equal(calls, log.runs);
  });

  it("does nothing for no candidates", async () => {
    const { raw, log } = standInSlots(2, () => 1);
    assert.deepEqual(await new ProofSlots(raw).proveInOrder([]), { certificates: [], outOfMemory: false });
    assert.equal(log.runs, 0);
  });
});
