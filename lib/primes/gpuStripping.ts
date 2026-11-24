/// <reference types="@webgpu/types" />
// Finding the small prime factors of ECPP curve orders on the GPU (CLAUDE.md,
// step 11c). The prover hands orders out a batch at a time (wasm/ecpp_prover.h,
// ecpp_prover_strip_request) and checks every factor reported with a division,
// so nothing here is trusted for correctness: a wrong factor is rejected and
// counted, and a missed one only makes the proof slower.
//
// The arithmetic is Montgomery reduction, one 32-bit limb at a time, in integers
// only (WGSL has 32-bit integers and no 64-bit product). Measured in step 11c
// (Apple Metal 3): about 50 to 58 billion limb-steps per second, 11× the
// prototype's eight `%` per limb, and exact on Metal and SwiftShader.

/**
 * The largest prime the kernel takes: Montgomery's sum t + m·p stays below 2^64
 * only for p < 2^31 (and t < 2p must fit in 32 bits). The bound is how deep
 * orders are stripped, which only decides speed, never which numbers can be
 * proven: an order with a factor above the bound is just skipped, and the prover
 * goes on to other curves. Step 11a's cost model puts the best bound at 10^7 to
 * 10^8, far below this.
 */
export const LARGEST_GPU_PRIME = 2 ** 31 - 1;

/** Primes go to the GPU in chunks timed to take about this long, so no dispatch runs long enough for the browser to reset the GPU (about 2 s on Windows), and the page's own drawing still gets its turn. */
const TARGET_CHUNK_MS = 30;
/** The first chunk's work, in limb-steps (orders × primes × limbs): about 0.3 ms on a fast GPU, 5 ms in software (SwiftShader). Later chunks are sized from measured time. */
const FIRST_CHUNK_LIMB_STEPS = 2 ** 24;
const WORKGROUP_SIZE = 64;
/** A chunk fits in one row of workgroups (maxComputeWorkgroupsPerDimension is at least 65,535). */
const MOST_PRIMES_PER_CHUNK = 65_535 * WORKGROUP_SIZE;
/** Each invocation takes one prime and at least this many orders, so its setup (the inverse of p) is shared. */
const ORDERS_PER_INVOCATION = 8;
/** Room for this many hits per chunk to start with; a chunk that finds more is run again with more room. */
const FIRST_HIT_CAPACITY = 4096;

/**
 * For each odd prime p (from `primes`) and each order N (`limbs` 32-bit limbs,
 * least significant first): t = N · 2^(−32·limbs) mod p, by Montgomery reduction
 * from the least significant limb. 2^(−32) is invertible mod an odd p, so t is 0
 * exactly when p divides N; each such (order, prime) is appended to `hits`.
 */
export const MONTGOMERY_STRIPPING_SHADER = /* wgsl */ `
struct Params { orderCount: u32, limbs: u32, primeCount: u32, ordersPerInvocation: u32 };
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> orders: array<u32>;
@group(0) @binding(2) var<storage, read> primes: array<u32>;
@group(0) @binding(3) var<storage, read_write> hitCount: atomic<u32>;
@group(0) @binding(4) var<storage, read_write> hits: array<u32>; // pairs: order index, prime

// The high 32 bits of a·b, from 16-bit halves.
fn multiply_high(a: u32, b: u32) -> u32 {
  let a0 = a & 0xFFFFu;
  let a1 = a >> 16u;
  let b0 = b & 0xFFFFu;
  let b1 = b >> 16u;
  let low = a0 * b0;
  let cross1 = a0 * b1;
  let cross2 = a1 * b0;
  let middle = (low >> 16u) + (cross1 & 0xFFFFu) + (cross2 & 0xFFFFu);
  return a1 * b1 + (cross1 >> 16u) + (cross2 >> 16u) + (middle >> 16u);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let primeIndex = id.x;
  if (primeIndex >= params.primeCount) { return; }
  let p = primes[primeIndex];
  // p^(-1) mod 2^32 by Newton's method: right to 3 bits from the start (p·p ≡ 1 mod 8), doubling each time
  var inverse = p;
  for (var round = 0u; round < 4u; round++) { inverse *= 2u - p * inverse; }
  let negated_inverse = 0u - inverse;
  let firstOrder = id.z * params.ordersPerInvocation;
  for (var k = 0u; k < params.ordersPerInvocation; k++) {
    let order = firstOrder + k;
    if (order >= params.orderCount) { break; }
    let base = order * params.limbs;
    var t = 0u; // below p
    for (var i = 0u; i < params.limbs; i++) {
      // T = t + limb, 33 bits: its low word and a carry. Then t = (T + m·p) / 2^32 with
      // m = T·(−p^(−1)) mod 2^32, which makes the low word of T + m·p zero: it carries
      // one exactly when the low word of T isn't zero. Below 2p.
      let low = t + orders[base + i];
      let carry = select(0u, 1u, low < t);
      let m = low * negated_inverse;
      t = carry + multiply_high(m, p) + select(0u, 1u, low != 0u);
      if (t >= p) { t -= p; }
    }
    if (t == 0u) {
      let slot = atomicAdd(&hitCount, 1u);
      if (slot < arrayLength(&hits) / 2u) {
        hits[2u * slot] = order;
        hits[2u * slot + 1u] = p;
      }
    }
  }
}`;

// ── The kernel's arithmetic, step for step in JavaScript (for the unit tests) ──

/** The high 32 bits of a·b for 32-bit a and b, exactly as the shader's multiply_high. */
export function multiplyHigh(a: number, b: number): number {
  const a0 = a & 0xffff;
  const a1 = a >>> 16;
  const b0 = b & 0xffff;
  const b1 = b >>> 16;
  const low = a0 * b0;
  const cross1 = a0 * b1;
  const cross2 = a1 * b0;
  const middle = (low >>> 16) + (cross1 & 0xffff) + (cross2 & 0xffff);
  return (a1 * b1 + (cross1 >>> 16) + (cross2 >>> 16) + (middle >>> 16)) >>> 0;
}

/** −p^(−1) mod 2^32 for an odd p, as the shader computes it. */
export function negatedInverse(p: number): number {
  let inverse = p >>> 0;
  for (let round = 0; round < 4; round++) inverse = Math.imul(inverse, (2 - Math.imul(p, inverse)) >>> 0) >>> 0;
  return (0 - inverse) >>> 0;
}

/** N · 2^(−32·limbs.length) mod p for an odd prime p below 2^31, as the shader computes it. */
export function montgomeryRemainder(limbs: Uint32Array, p: number): number {
  const negated = negatedInverse(p);
  let t = 0;
  for (let index = 0; index < limbs.length; index++) {
    const low = (t + limbs[index]) >>> 0;
    const carry = low < t ? 1 : 0;
    const m = Math.imul(low, negated) >>> 0;
    t = carry + multiplyHigh(m, p) + (low !== 0 ? 1 : 0);
    if (t >= p) t -= p;
  }
  return t;
}

// ── The primes ────────────────────────────────────────────────────────────────

/** Numbers per segment of the CPU sieve that lists the primes (odd numbers only, a byte each). */
const SIEVE_SEGMENT_NUMBERS = 2 ** 20;

/**
 * The odd primes in order, extended by a segmented sieve as far as asked and
 * kept (4 bytes each: 23 MB to 10^8). Base primes up to √(2^31) are under 46,341.
 */
export class OddPrimeList {
  private primes: Uint32Array<ArrayBuffer> = new Uint32Array(1024);
  private count = 0;
  /** Every odd prime below this is listed. */
  private sievedBelow = 3;
  private basePrimes: number[] = [];
  private readonly segmentNumbers: number;

  constructor(segmentNumbers = SIEVE_SEGMENT_NUMBERS) {
    this.segmentNumbers = segmentNumbers;
  }

  /** The odd primes up to and including `largest`. The view is valid until the next call. */
  upTo(largest: number): Uint32Array<ArrayBuffer> {
    while (this.sievedBelow <= largest) this.sieveNextSegment();
    // how many listed primes are ≤ largest, by binary search
    let below = 0;
    let above = this.count;
    while (below < above) {
      const middle = (below + above) >>> 1;
      if (this.primes[middle] <= largest) below = middle + 1;
      else above = middle;
    }
    return this.primes.subarray(0, below);
  }

  private sieveNextSegment() {
    const low = this.sievedBelow; // odd
    const high = Math.min(low + this.segmentNumbers, LARGEST_GPU_PRIME + 2); // exclusive
    this.extendBasePrimes(Math.floor(Math.sqrt(high)) + 1);
    // index i stands for low + 2i
    const composite = new Uint8Array(Math.ceil((high - low) / 2));
    for (const basePrime of this.basePrimes) {
      const square = basePrime * basePrime;
      if (square >= high) break;
      let first = Math.max(square, Math.ceil(low / basePrime) * basePrime);
      if (first % 2 === 0) first += basePrime;
      for (let multiple = first; multiple < high; multiple += 2 * basePrime) composite[(multiple - low) / 2] = 1;
    }
    for (let index = 0; index < composite.length; index++) {
      if (composite[index]) continue;
      if (this.count === this.primes.length) {
        const grown = new Uint32Array(this.primes.length * 2);
        grown.set(this.primes);
        this.primes = grown;
      }
      this.primes[this.count++] = low + 2 * index;
    }
    this.sievedBelow = high;
  }

  /** Odd base primes up to `limit`, by a plain sieve (limit stays below 46,342). */
  private extendBasePrimes(limit: number) {
    const known = this.basePrimes.length === 0 ? 2 : this.basePrimes[this.basePrimes.length - 1];
    if (known >= limit) return;
    const composite = new Uint8Array(limit + 1);
    this.basePrimes = [];
    for (let candidate = 3; candidate <= limit; candidate += 2) {
      if (composite[candidate]) continue;
      this.basePrimes.push(candidate);
      for (let multiple = candidate * candidate; multiple <= limit; multiple += 2 * candidate) composite[multiple] = 1;
    }
  }
}

// ── The GPU ───────────────────────────────────────────────────────────────────

/** A prime that divides order number `order` of a strip call. */
export interface StripHit {
  order: number;
  prime: number;
}

/** The GPU failed (device lost, out of memory, a validation error): the caller strips on the CPU instead. */
export class GpuStrippingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GpuStrippingError";
  }
}

/**
 * The GPU's stripper: one device and pipeline, kept for the life of the worker.
 * strip() calls run one at a time, in the order they're made.
 */
export class GpuStripper {
  private readonly device: GPUDevice;
  private readonly pipeline: GPUComputePipeline;
  private readonly primeList = new OddPrimeList();
  private lostReason: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /** Measured: limb-steps per millisecond, for sizing chunks. */
  private limbStepsPerMs: number | null = null;
  private hitCapacity = FIRST_HIT_CAPACITY;

  private constructor(device: GPUDevice, pipeline: GPUComputePipeline) {
    this.device = device;
    this.pipeline = pipeline;
    device.lost.then((info) => {
      this.lostReason = info.message || info.reason || "the GPU device was lost";
    });
  }

  /** A stripper, or null if this browser or device can't run WebGPU (then the CPU strips). */
  static async create(gpu: GPU | undefined = globalThis.navigator?.gpu): Promise<GpuStripper | null> {
    if (!gpu) return null;
    try {
      const adapter = await gpu.requestAdapter();
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      const shaderModule = device.createShaderModule({ code: MONTGOMERY_STRIPPING_SHADER });
      const errors = (await shaderModule.getCompilationInfo()).messages.filter((message) => message.type === "error");
      if (errors.length > 0) {
        device.destroy();
        return null;
      }
      const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module: shaderModule, entryPoint: "main" } });
      return new GpuStripper(device, pipeline);
    } catch {
      return null;
    }
  }

  /**
   * Every prime up to `largestPrime` that divides each order (limbs, least
   * significant first, any number of them), each reported once per order. 2 is
   * found here from the lowest bit. Rejects with GpuStrippingError if the GPU
   * fails, or with the signal's reason once `signal` aborts (checked between
   * chunks, so within about 30 ms).
   */
  strip(orders: readonly Uint32Array[], largestPrime: number, signal?: AbortSignal): Promise<StripHit[]> {
    const run = this.queue.then(() => this.stripNow(orders, largestPrime, signal));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Limb-steps per second on this device, as a real strip call sees them (uploads,
   * chunks and read-backs included): 64 random 300-digit orders against the
   * primes below 2^24, about 2 billion limb-steps (40 ms on an Apple M-series
   * GPU, about a second in software).
   */
  async measureRate(): Promise<number> {
    const limbs = 32;
    const largestPrime = 2 ** 24;
    const orders = Array.from({ length: 64 }, () => {
      const order = new Uint32Array(limbs);
      crypto.getRandomValues(order);
      return order;
    });
    const primeCount = this.primeList.upTo(largestPrime).length;
    await this.strip(orders, largestPrime); // warm-up: compiles, allocates, sizes the chunks
    const start = performance.now();
    await this.strip(orders, largestPrime);
    const seconds = Math.max(performance.now() - start, 0.001) / 1000;
    return (orders.length * primeCount * limbs) / seconds;
  }

  destroy() {
    this.device.destroy();
  }

  private async stripNow(orders: readonly Uint32Array[], largestPrime: number, signal?: AbortSignal): Promise<StripHit[]> {
    signal?.throwIfAborted();
    if (!Number.isInteger(largestPrime) || largestPrime < 2 || largestPrime > LARGEST_GPU_PRIME) {
      throw new RangeError(`largestPrime must be a whole number from 2 to ${LARGEST_GPU_PRIME}`);
    }
    this.throwIfLost();
    const hits: StripHit[] = [];
    orders.forEach((order, index) => {
      if (order.length > 0 && (order[0] & 1) === 0) hits.push({ order: index, prime: 2 });
    });
    const primes = this.primeList.upTo(largestPrime);
    if (orders.length === 0 || primes.length === 0) return hits;

    // Every order padded to the longest: zero limbs at the top don't change whether p divides it.
    const limbs = Math.max(1, ...orders.map((order) => order.length));
    const orderWords = new Uint32Array(orders.length * limbs);
    orders.forEach((order, index) => orderWords.set(order, index * limbs));

    const device = this.device;
    const buffers: GPUBuffer[] = [];
    const buffer = (size: number, usage: GPUBufferUsageFlags) => {
      const created = device.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage });
      buffers.push(created);
      return created;
    };
    try {
      device.pushErrorScope("out-of-memory");
      device.pushErrorScope("validation");
      const params = buffer(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      const orderBuffer = buffer(orderWords.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      device.queue.writeBuffer(orderBuffer, 0, orderWords);
      const largestChunk = Math.min(primes.length, MOST_PRIMES_PER_CHUNK);
      const primeBuffer = buffer(largestChunk * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      const counter = buffer(4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
      const readCounter = buffer(4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
      await this.throwOnErrors();

      // Where hits go: made again, larger, when a chunk finds more than there's room for.
      const hitBuffers = () => {
        const storage = buffer(this.hitCapacity * 8, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
        const readable = buffer(this.hitCapacity * 8, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
        const bindGroup = device.createBindGroup({
          layout: this.pipeline.getBindGroupLayout(0),
          entries: [params, orderBuffer, primeBuffer, counter, storage].map((resource, binding) => ({
            binding,
            resource: { buffer: resource },
          })),
        });
        return { storage, readable, bindGroup };
      };
      let hitRoom = hitBuffers();

      // Orders go across the third dimension of workgroups, at most 65,535 of them, so
      // each invocation takes enough orders to cover them all.
      const ordersPerInvocation = Math.max(ORDERS_PER_INVOCATION, Math.ceil(orders.length / 65_535));
      const limbStepsPerPrime = orders.length * limbs;
      let start = 0;
      while (start < primes.length) {
        signal?.throwIfAborted();
        const wanted = Math.floor(
          this.limbStepsPerMs === null
            ? FIRST_CHUNK_LIMB_STEPS / limbStepsPerPrime
            : (this.limbStepsPerMs * TARGET_CHUNK_MS) / limbStepsPerPrime,
        );
        const count = Math.min(primes.length - start, largestChunk, Math.max(WORKGROUP_SIZE, wanted));
        const chunk = primes.subarray(start, start + count);

        device.pushErrorScope("out-of-memory");
        device.pushErrorScope("validation");
        device.queue.writeBuffer(params, 0, new Uint32Array([orders.length, limbs, count, ordersPerInvocation]));
        device.queue.writeBuffer(primeBuffer, 0, chunk);
        device.queue.writeBuffer(counter, 0, new Uint32Array([0]));
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, hitRoom.bindGroup);
        pass.dispatchWorkgroups(Math.ceil(count / WORKGROUP_SIZE), 1, Math.ceil(orders.length / ordersPerInvocation));
        pass.end();
        encoder.copyBufferToBuffer(counter, 0, readCounter, 0, 4);
        encoder.copyBufferToBuffer(hitRoom.storage, 0, hitRoom.readable, 0, this.hitCapacity * 8);
        const began = performance.now();
        device.queue.submit([encoder.finish()]);
        await this.throwOnErrors();
        const hitCount = await this.read(readCounter, (words) => words[0]);
        const elapsedMs = performance.now() - began;
        this.limbStepsPerMs = (count * limbStepsPerPrime) / Math.max(elapsedMs, 0.05);

        if (hitCount > this.hitCapacity) {
          // more hits than room: run this chunk again with enough (none is ever dropped)
          this.hitCapacity = 2 ** Math.ceil(Math.log2(hitCount));
          hitRoom.storage.destroy();
          hitRoom.readable.destroy();
          hitRoom = hitBuffers();
          continue;
        }
        if (hitCount === 0) {
          start += count;
          continue;
        }
        const pairs = await this.read(hitRoom.readable, (words) => words.slice(0, 2 * hitCount));
        for (let index = 0; index < hitCount; index++) hits.push({ order: pairs[2 * index], prime: pairs[2 * index + 1] });
        start += count;
      }
      return hits;
    } catch (error) {
      if (error instanceof GpuStrippingError || signal?.aborted) throw error;
      throw new GpuStrippingError(this.lostReason ?? (error instanceof Error ? error.message : String(error)));
    } finally {
      for (const created of buffers) created.destroy();
    }
  }

  /** Maps a buffer for reading, takes what's wanted from it, and unmaps it. */
  private async read<Result>(mappable: GPUBuffer, take: (words: Uint32Array) => Result): Promise<Result> {
    await mappable.mapAsync(GPUMapMode.READ);
    try {
      return take(new Uint32Array(mappable.getMappedRange()));
    } finally {
      mappable.unmap();
    }
  }

  /** Pops the two error scopes pushed before a step (validation, then out-of-memory). */
  private async throwOnErrors() {
    const validation = await this.device.popErrorScope();
    const outOfMemory = await this.device.popErrorScope();
    const error = validation ?? outOfMemory;
    if (error) throw new GpuStrippingError(error.message);
    this.throwIfLost();
  }

  private throwIfLost() {
    if (this.lostReason !== null) throw new GpuStrippingError(this.lostReason);
  }
}
