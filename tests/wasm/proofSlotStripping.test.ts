// External stripping through ProofSlots (step 11d) in both shipped builds, with
// stand-ins for the GPU: exact (trial division in BigInt), slow, lying, missing
// factors, failing, and one held back across a pause. Whatever the stripper does,
// every certificate must pass the independent checker; with an exact stripper to
// the CPU's own bound (10^5 below 830 bits), certificates must be exactly the
// CPU's; and a stripper that's wrong or fails must be dropped, with the proof
// finishing on the CPU. The same holds through the GPU worker's messages
// (RemoteGpuStripper over a MessageChannel).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { GpuStrippingError, OddPrimeList, type StripHit } from "../../lib/primes/gpuStripping.ts";
import { checkCertificate, type CertificateStep } from "../../lib/primes/primalityCertificate.ts";
import {
  ProofSlots,
  type OrderStripper,
  type RawProofSlotExports,
  type StripperFailure,
  type StripReport,
} from "../../lib/primes/proofSlots.ts";
import {
  rawProofSlotExportsOf,
  THREADED_INITIAL_MEMORY_BYTES,
  type CreateSieveModule,
} from "../../lib/primes/threadedSieveModule.ts";
import { GPU_CALL_TIMED_OUT_MESSAGE, RemoteGpuStripper } from "../../lib/primes/remoteGpuStripper.ts";
import { closeGpuStrippingChannels, gpuStrippingChannel } from "../support/gpuStrippingChannel.ts";
import { isPrime, nextPrimeAfter } from "../support/primality.ts";

const A13 = 3_317_044_064_679_887_385_961_981n;
/** The CPU's own stripping bound for every candidate here (below 830 bits). */
const CPU_BOUND = 99_999;

function candidates(): bigint[] {
  const found: bigint[] = [];
  for (const start of [A13, 10n ** 30n, 10n ** 45n, 10n ** 60n]) {
    let n = start;
    for (let index = 0; index < 3; index++) found.push((n = nextPrimeAfter(n)));
  }
  return found.filter((n) => isPrime(n));
}

const toBigInt = (limbs: Uint32Array) => limbs.reduceRight((value, limb) => (value << 32n) | BigInt(limb), 0n);
const PRIMES = [2, ...new OddPrimeList().upTo(1_000_000)];

/** Every prime up to largestPrime that divides each order, by BigInt trial division. */
function exactHits(orders: readonly Uint32Array[], largestPrime: number): StripHit[] {
  const hits: StripHit[] = [];
  orders.forEach((order, index) => {
    const value = toBigInt(order);
    for (const prime of PRIMES) {
      if (prime > largestPrime) break;
      if (value % BigInt(prime) === 0n) hits.push({ order: index, prime });
    }
  });
  return hits;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A stand-in GPU: answers exactly after `delayMs`, then `change` may alter the answer or throw. */
function standIn(
  delayMs = 0,
  change: (hits: StripHit[], call: number, orders: readonly Uint32Array[]) => StripHit[] = (hits) => hits,
) {
  const record = { calls: 0, aborted: 0, orders: 0 };
  const stripper: OrderStripper = {
    async strip(orders, largestPrime, signal) {
      const call = record.calls++;
      record.orders += orders.length;
      await pause(delayMs);
      if (signal?.aborted) {
        record.aborted++;
        throw signal.reason;
      }
      return change(exactHits(orders, largestPrime), call, orders);
    },
  };
  return { stripper, record };
}

interface Build {
  name: string;
  slots: ProofSlots;
  raw: RawProofSlotExports;
}

async function loadBuilds(): Promise<Build[]> {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(readFileSync("public/sieve.wasm")), {
    env: { emscripten_notify_memory_growth: () => {} },
  });
  (instance.exports._initialize as (() => void) | undefined)?.();
  const singleRaw = instance.exports as unknown as RawProofSlotExports;
  const single = new ProofSlots(singleRaw);

  const { default: createSieveModule } = (await import(pathToFileURL("public/sieve-threads/sieve.mjs").href)) as {
    default: CreateSieveModule;
  };
  const wasmMemory = new WebAssembly.Memory({
    initial: THREADED_INITIAL_MEMORY_BYTES / 65_536,
    maximum: 2 ** 32 / 65_536,
    shared: true,
  });
  const sieveModule = await createSieveModule({ wasmMemory, sieveHelperThreads: 8 });
  assert.equal(sieveModule._sieve_start_helpers(8), 8);
  const threadedRaw = rawProofSlotExportsOf(sieveModule);
  const threaded = new ProofSlots(threadedRaw);
  return [
    { name: "sieve.wasm (one slot)", slots: single, raw: singleRaw },
    { name: "the threaded build (9 slots)", slots: threaded, raw: threadedRaw },
  ];
}

function assertAllValid(all: readonly bigint[], certificates: readonly CertificateStep[][]) {
  assert.equal(certificates.length, all.length);
  certificates.forEach((steps, index) => assert.deepEqual(checkCertificate(all[index], steps), { valid: true }));
}

describe("external stripping through proof slots, in both shipped builds", () => {
  let builds: Build[] = [];
  const all = candidates();
  /** The CPU's certificates for `all`, per build, to compare with. */
  const onTheCpu = new Map<string, CertificateStep[][]>();

  after(closeGpuStrippingChannels);

  before(async () => {
    builds = await loadBuilds();
    for (const { name, slots } of builds) {
      slots.useStripper(null);
      const { certificates } = await slots.proveInOrder(all, { workPerRun: 8 });
      assertAllValid(all, certificates);
      onTheCpu.set(name, certificates);
    }
  });

  /** Proves `all` with a stripper; returns the certificates, failures and reports. */
  async function proveWith(
    slots: ProofSlots,
    stripper: OrderStripper,
    options: { perBatch?: number; largestPrime?: number; spotCheckEvery?: number } = {},
  ) {
    const failures: StripperFailure[] = [];
    const reports: StripReport[] = [];
    slots.useStripper({
      stripper,
      discriminantsPerBatch: options.perBatch ?? 4,
      externalFromBits: 0,
      largestPrimeFor: () => options.largestPrime ?? CPU_BOUND,
      onFailure: (failure) => failures.push(failure),
      onStripped: (report) => reports.push(report),
      spotCheckEvery: options.spotCheckEvery,
    });
    const result = await slots.proveInOrder(all, { workPerRun: 8, betweenRuns: () => pause(0) });
    const stillStripping = slots.stripping();
    slots.useStripper(null);
    return { ...result, failures, reports, stillStripping };
  }

  for (const index of [0, 1]) {
    describe(index === 0 ? "sieve.wasm (one slot)" : "the threaded build (9 slots)", () => {
      const build = () => builds[index];

      it("an exact stripper to the CPU's bound gives exactly the CPU's certificates, in batches of 1 and 4", async () => {
        for (const perBatch of [1, 4]) {
          const { stripper, record } = standIn();
          const { certificates, failures, reports, stillStripping } = await proveWith(build().slots, stripper, { perBatch, spotCheckEvery: 1 });
          assert.deepEqual(certificates, onTheCpu.get(build().name));
          assert.deepEqual(failures, []);
          assert.equal(stillStripping, true);
          assert.ok(record.calls > 0 && reports.length > 0, "the stripper was used");
          if (index === 1) assert.ok(reports.some((report) => report.orderCount > 6), "batches from several slots go in one call");
        }
      });

      it("a stripper that joins between runs (its worker started late) is used from then on, second provers too", async () => {
        const { slots, raw } = build();
        const { stripper, record } = standIn();
        const perThread = raw.proof_slots_per_thread();
        let runs = 0;
        let secondProverBusy = false;
        slots.useStripper(null);
        const { certificates } = await slots.proveInOrder(all, {
          workPerRun: 8,
          betweenRuns: async () => {
            if (runs++ === 0) {
              assert.equal(record.calls, 0);
              slots.useStripper({ stripper, discriminantsPerBatch: 4, externalFromBits: 0, largestPrimeFor: () => CPU_BOUND, spotCheckEvery: 1 });
            }
            for (let slot = 0; slot < raw.proof_slot_count(); slot++) {
              if (slot % perThread !== 0 && raw.proof_slot_progress(slot) !== 0) secondProverBusy = true;
            }
            await pause(0);
          },
        });
        const stillStripping = slots.stripping();
        slots.useStripper(null);
        assert.equal(stillStripping, true);
        assert.ok(record.calls > 0, "the stripper was used");
        assert.ok(secondProverBusy, "the second provers started once it joined");
        assert.deepEqual(certificates, onTheCpu.get(build().name));
      });

      it("a slow stripper: slots wait for it, and the certificates are the same", async () => {
        const { stripper } = standIn(15);
        const { certificates, failures, reports } = await proveWith(build().slots, stripper);
        assert.deepEqual(certificates, onTheCpu.get(build().name));
        assert.deepEqual(failures, []);
        assert.ok(reports.some((report) => report.waitedMs > 0), "the slots waited for it");
      });

      it("a stripper that claims a false factor is dropped, and the proofs finish on the CPU, unchanged", async () => {
        const { stripper, record } = standIn(0, (hits, call, orders) => {
          if (call !== 2) return hits;
          let liar = 3;
          const order = toBigInt(orders[0]);
          while (order % BigInt(liar) === 0n) liar += 2;
          return [...hits, { order: 0, prime: liar }];
        });
        const { certificates, failures, stillStripping } = await proveWith(build().slots, stripper);
        assert.deepEqual(failures, [{ kind: "wrong-factor" }]);
        assert.equal(stillStripping, false);
        assert.equal(record.calls, 3, "never asked again");
        assert.deepEqual(certificates, onTheCpu.get(build().name));
      });

      it("a stripper that misses small factors is caught by the spot check and dropped", async () => {
        const { stripper } = standIn(0, (hits, call) => (call === 1 ? hits.filter((hit) => hit.prime > 10_000) : hits));
        const { certificates, failures, stillStripping } = await proveWith(build().slots, stripper, { spotCheckEvery: 1 });
        assert.equal(failures.length, 1);
        assert.equal(failures[0].kind, "missed-factor");
        assert.equal(stillStripping, false);
        assertAllValid(all, certificates);
      });

      it("a stripper that fails is dropped, and the proofs finish on the CPU, unchanged", async () => {
        const { stripper, record } = standIn(0, (hits, call) => {
          if (call === 1) throw new GpuStrippingError("Device was lost.");
          return hits;
        });
        const { certificates, failures, stillStripping } = await proveWith(build().slots, stripper);
        assert.deepEqual(failures, [{ kind: "error", message: "Device was lost." }]);
        assert.equal(stillStripping, false);
        assert.equal(record.calls, 2);
        assert.deepEqual(certificates, onTheCpu.get(build().name));
      });

      it("stripping deeper than the CPU still gives certificates that check", async () => {
        const { stripper } = standIn();
        const { certificates, failures } = await proveWith(build().slots, stripper, { largestPrime: 1_000_000 });
        assert.deepEqual(failures, []);
        assertAllValid(all, certificates);
      });

      it("through the GPU worker's messages: the CPU's certificates exactly; a false factor is dropped", async () => {
        const remoteOf = async (stripper: OrderStripper) => {
          const { endpoint } = gpuStrippingChannel(async () => ({ ...stripper, destroy: () => {} }));
          const remote = await RemoteGpuStripper.create(endpoint);
          assert.ok(remote);
          return remote;
        };
        const exact = await remoteOf(standIn().stripper);
        const honest = await proveWith(build().slots, exact, { spotCheckEvery: 1 });
        exact.destroy();
        assert.deepEqual(honest.certificates, onTheCpu.get(build().name));
        assert.deepEqual(honest.failures, []);
        assert.ok(honest.reports.length > 0, "the stripper was used");

        const lying = await remoteOf(
          standIn(0, (hits, call, orders) => {
            if (call !== 1) return hits;
            let liar = 3;
            const order = toBigInt(orders[0]);
            while (order % BigInt(liar) === 0n) liar += 2;
            return [...hits, { order: 0, prime: liar }];
          }).stripper,
        );
        const dropped = await proveWith(build().slots, lying);
        lying.destroy();
        assert.deepEqual(dropped.failures, [{ kind: "wrong-factor" }]);
        assert.equal(dropped.stillStripping, false);
        assert.deepEqual(dropped.certificates, onTheCpu.get(build().name));
      });

      it("through the GPU worker: a call that never comes back is given up on, and the proofs finish on the CPU, unchanged", async () => {
        const honest = standIn().stripper;
        let calls = 0;
        const hanging: OrderStripper = {
          strip: (orders, largestPrime, signal) => (++calls === 2 ? new Promise(() => {}) : honest.strip(orders, largestPrime, signal)),
        };
        const { endpoint } = gpuStrippingChannel(async () => ({ ...hanging, destroy: () => {} }));
        const remote = await RemoteGpuStripper.create(endpoint, { callTimeoutMs: 100 });
        assert.ok(remote);
        const { certificates, failures, stillStripping } = await proveWith(build().slots, remote);
        remote.destroy();
        assert.deepEqual(failures, [{ kind: "error", message: GPU_CALL_TIMED_OUT_MESSAGE }]);
        assert.equal(stillStripping, false);
        assert.deepEqual(certificates, onTheCpu.get(build().name));
      });

      it("a pause with a strip on its way calls it off; resumed, the batches are sent again and the certificates are the same", async () => {
        const slow = standIn(50);
        const slots = build().slots;
        slots.useStripper({ stripper: slow.stripper, discriminantsPerBatch: 4, externalFromBits: 0, largestPrimeFor: () => CPU_BOUND });
        const paused = await slots.proveInOrder(all, { workPerRun: 8, betweenRuns: () => pause(0), shouldStop: () => slow.record.calls > 0 });
        assert.equal(paused.stopped, true);
        await pause(80);
        assert.equal(slow.record.aborted, 1, "the call on its way was called off");
        const exact = standIn();
        const failures: StripperFailure[] = [];
        slots.useStripper({
          stripper: exact.stripper,
          discriminantsPerBatch: 4,
          externalFromBits: 0,
          largestPrimeFor: () => CPU_BOUND,
          onFailure: (failure) => failures.push(failure),
          spotCheckEvery: 1,
        });
        const resumed = await slots.proveInOrder(all, { workPerRun: 8, betweenRuns: () => pause(0) });
        slots.useStripper(null);
        assert.deepEqual(failures, []);
        assert.ok(exact.record.calls > 0);
        assert.deepEqual(resumed.certificates, onTheCpu.get(build().name));
      });
    });
  }
});
