import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { closeGpuStrippingChannels, gpuStrippingChannel } from "../../tests/support/gpuStrippingChannel.ts";
import { GpuStrippingError, type StripHit } from "./gpuStripping.ts";
import type { DisposableStripper } from "./gpuStrippingControl.ts";
import { GPU_CALL_TIMED_OUT_MESSAGE, GPU_WORKER_STOPPED_MESSAGE, RemoteGpuStripper } from "./remoteGpuStripper.ts";

const toBigInt = (limbs: Uint32Array) => limbs.reduceRight((value, limb) => (value << 32n) | BigInt(limb), 0n);

const ODD_PRIMES_BELOW_100 = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];

/** A stand-in GPU in the worker: odd primes below 100 by BigInt, or `strip` given. */
function standIn(strip?: DisposableStripper["strip"]) {
  const record = { calls: [] as { orders: bigint[]; largestPrime: number }[], destroyed: 0, signals: [] as AbortSignal[] };
  const stripper: DisposableStripper = {
    strip:
      strip ??
      (async (orders, largestPrime, signal) => {
        record.calls.push({ orders: orders.map(toBigInt), largestPrime });
        if (signal) record.signals.push(signal);
        const hits: StripHit[] = [];
        orders.forEach((order, index) => {
          for (const prime of ODD_PRIMES_BELOW_100) if (toBigInt(order) % BigInt(prime) === 0n) hits.push({ order: index, prime });
        });
        return hits;
      }),
    destroy: () => void record.destroyed++,
  };
  return { stripper, record };
}

const limbsOf = (value: bigint) => {
  const limbs: number[] = [];
  for (; value > 0n; value >>= 32n) limbs.push(Number(value & 0xffff_ffffn));
  return Uint32Array.from(limbs);
};

describe("RemoteGpuStripper and the GPU worker", () => {
  afterEach(closeGpuStrippingChannels);

  it("answers exactly as the stripper in the worker does, orders intact, calls kept apart", async () => {
    const { stripper, record } = standIn();
    const { endpoint } = gpuStrippingChannel(async () => stripper);
    const remote = await RemoteGpuStripper.create(endpoint);
    assert.ok(remote);
    const first = [3n * 5n * 7n * 2n ** 70n, 2n ** 127n - 1n].map(limbsOf);
    const second = [11n * 13n * 10n ** 40n].map(limbsOf);
    const [firstHits, secondHits] = await Promise.all([remote.strip(first, 1_000), remote.strip(second, 2_000)]);
    assert.deepEqual(firstHits, [
      { order: 0, prime: 3 },
      { order: 0, prime: 5 },
      { order: 0, prime: 7 },
    ]);
    assert.deepEqual(secondHits, [
      { order: 0, prime: 5 },
      { order: 0, prime: 11 },
      { order: 0, prime: 13 },
    ]);
    assert.deepEqual(record.calls, [
      { orders: first.map(toBigInt), largestPrime: 1_000 },
      { orders: second.map(toBigInt), largestPrime: 2_000 },
    ]);
    remote.destroy();
  });

  it("no GPU in the worker, or one that can't be made: null, and the worker is ended", async () => {
    for (const create of [async () => null, async () => Promise.reject(new Error("no adapter"))]) {
      const { endpoint, record } = gpuStrippingChannel(create);
      assert.equal(await RemoteGpuStripper.create(endpoint), null);
      assert.equal(record.terminated, true);
    }
  });

  it("a worker that fails to start: null, and it's ended", async () => {
    const { endpoint, record, crash } = gpuStrippingChannel(() => new Promise(() => {}));
    const made = RemoteGpuStripper.create(endpoint);
    crash();
    assert.equal(await made, null);
    assert.equal(record.terminated, true);
  });

  it("a call that fails in the worker rejects as a GpuStrippingError with its message", async () => {
    const { stripper } = standIn(async () => {
      throw new GpuStrippingError("Device was lost.");
    });
    const { endpoint } = gpuStrippingChannel(async () => stripper);
    const remote = await RemoteGpuStripper.create(endpoint);
    assert.ok(remote);
    await assert.rejects(remote.strip([limbsOf(15n)], 100), (error: unknown) => error instanceof GpuStrippingError && error.message === "Device was lost.");
    remote.destroy();
  });

  it("a call called off rejects at once with the signal's reason, and the worker's call is called off too", async () => {
    let workerSignal: AbortSignal | undefined;
    const { stripper } = standIn(
      (_orders, _largestPrime, signal) =>
        new Promise((_resolve, reject) => {
          workerSignal = signal;
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const { endpoint } = gpuStrippingChannel(async () => stripper);
    const remote = await RemoteGpuStripper.create(endpoint);
    assert.ok(remote);
    const abort = new AbortController();
    const call = remote.strip([limbsOf(15n)], 100, abort.signal);
    while (!workerSignal) await new Promise((resolve) => setTimeout(resolve, 1));
    const reason = new Error("stop");
    abort.abort(reason);
    await assert.rejects(call, (error) => error === reason);
    while (!workerSignal.aborted) await new Promise((resolve) => setTimeout(resolve, 1));
    // a call already called off isn't sent at all
    await assert.rejects(remote.strip([limbsOf(15n)], 100, abort.signal), (error) => error === reason);
    remote.destroy();
  });

  it("a worker that stops: calls on their way and every later one fail as a GpuStrippingError", async () => {
    const { stripper } = standIn(() => new Promise(() => {}));
    const { endpoint, crash } = gpuStrippingChannel(async () => stripper);
    const remote = await RemoteGpuStripper.create(endpoint);
    assert.ok(remote);
    const onItsWay = remote.strip([limbsOf(15n)], 100);
    await new Promise((resolve) => setTimeout(resolve, 5));
    crash();
    const stopped = (error: unknown) => error instanceof GpuStrippingError && error.message === GPU_WORKER_STOPPED_MESSAGE;
    await assert.rejects(onItsWay, stopped);
    await assert.rejects(remote.strip([limbsOf(15n)], 100), stopped);
    remote.destroy();
  });

  it("destroy ends the worker, and calls on their way fail", async () => {
    const { stripper } = standIn(() => new Promise(() => {}));
    const { endpoint, record } = gpuStrippingChannel(async () => stripper);
    const remote = await RemoteGpuStripper.create(endpoint);
    assert.ok(remote);
    const onItsWay = remote.strip([limbsOf(15n)], 100);
    remote.destroy();
    assert.equal(record.terminated, true);
    await assert.rejects(onItsWay, GpuStrippingError);
    await assert.rejects(remote.strip([limbsOf(15n)], 100), GpuStrippingError);
  });

  it("gives up on a call that doesn't come back in time: it and every later call fail as a GPU error", async () => {
    let calls = 0;
    const { stripper } = standIn(() => (++calls === 1 ? new Promise(() => {}) : Promise.resolve([])));
    const { endpoint } = gpuStrippingChannel(async () => stripper);
    const remote = await RemoteGpuStripper.create(endpoint, { callTimeoutMs: 50 });
    assert.ok(remote);
    const started = performance.now();
    await assert.rejects(remote.strip([limbsOf(15n)], 100), (error) => error instanceof GpuStrippingError && error.message === GPU_CALL_TIMED_OUT_MESSAGE);
    assert.ok(performance.now() - started >= 45, "not before its time");
    await assert.rejects(remote.strip([limbsOf(15n)], 100), (error) => error instanceof GpuStrippingError && error.message === GPU_CALL_TIMED_OUT_MESSAGE);
    remote.destroy();
  });

  it("a call that answers in time, or is called off, never times out afterwards", async () => {
    const { stripper } = standIn();
    const { endpoint } = gpuStrippingChannel(async () => stripper);
    const remote = await RemoteGpuStripper.create(endpoint, { callTimeoutMs: 50 });
    assert.ok(remote);
    assert.deepEqual(await remote.strip([limbsOf(15n)], 100), [{ order: 0, prime: 3 }, { order: 0, prime: 5 }]);
    const controller = new AbortController();
    const calledOff = remote.strip([limbsOf(15n)], 100, controller.signal);
    controller.abort(new Error("called off"));
    await assert.rejects(calledOff, /called off/);
    await new Promise((resolve) => setTimeout(resolve, 120)); // past both deadlines
    assert.deepEqual(await remote.strip([limbsOf(21n)], 100), [{ order: 0, prime: 3 }, { order: 0, prime: 7 }]);
    remote.destroy();
  });
});
