// Randomized tests of wasm/primality.c (deterministic Miller–Rabin) at any
// size, against the app's own TypeScript verifier (lib/primes/verifyPrimes.ts),
// which shares no code with it. Composite evidence is re-checked here too,
// with a BigInt strong test, the way the app will re-check it (Phase 4,
// stage 3). The module is the harness built by `npm run test:wasm`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DETERMINISTIC_VERIFICATION_LIMIT, millerRabinVerdict, type Verdict } from "../../lib/primes/verifyPrimes.ts";

interface Harness {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  harness_first_input(): number;
  harness_last_evidence(): number;
  harness_miller_rabin(count: number): number;
  harness_miller_rabin_multi_limb(count: number): number;
  harness_strong_probable_prime(count: number, base: number): number;
}

const { instance } = await WebAssembly.instantiate(readFileSync(".cache/bignum_harness.wasm"), {
  env: { emscripten_notify_memory_growth: () => {} },
});
const harness = instance.exports as unknown as Harness;
harness._initialize?.();

// primality_verdict in wasm/primality.h, in order.
const C_VERDICTS = ["prime", "composite-by-factor", "composite-by-witness", "below-two", "beyond-proven-bound", "out-of-memory"] as const;
type CVerdict = (typeof C_VERDICTS)[number];

const BASES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n];
const TWO_TO_THE_64 = 1n << 64n;
/** A014233's last two bounds, above 2^64. */
const A12 = 318_665_857_834_031_151_167_461n;
const A13 = 3_317_044_064_679_887_385_961_981n;

// ── calling the harness ───────────────────────────────────────────────────

/** Writes a BigInt as limbs into the first input, least significant first. Returns the limb count. */
function writeCandidate(value: bigint): number {
  const limbs: number[] = [];
  for (let rest = value; rest > 0n; rest >>= 32n) limbs.push(Number(rest & 0xffffffffn));
  const pointer = harness.harness_first_input() >>> 0;
  new Uint32Array(harness.memory.buffer, pointer, limbs.length).set(limbs); // fresh view each time
  return limbs.length;
}

function cVerdict(candidate: bigint, path: "dispatching" | "multi-limb" = "dispatching"): { verdict: CVerdict; evidence: bigint } {
  const count = writeCandidate(candidate);
  const verdictIndex =
    path === "dispatching" ? harness.harness_miller_rabin(count) : harness.harness_miller_rabin_multi_limb(count);
  return { verdict: C_VERDICTS[verdictIndex], evidence: BigInt(harness.harness_last_evidence() >>> 0) };
}

// ── an independent strong test, to check a witness ────────────────────────

function powerMod(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  base %= modulus;
  for (let rest = exponent; rest > 0n; rest >>= 1n) {
    if (rest & 1n) result = (result * base) % modulus;
    base = (base * base) % modulus;
  }
  return result;
}

function passesStrongTest(candidate: bigint, base: bigint): boolean {
  let oddPart = candidate - 1n;
  let powersOfTwo = 0;
  while ((oddPart & 1n) === 0n) {
    oddPart >>= 1n;
    powersOfTwo++;
  }
  let value = powerMod(base, oddPart, candidate);
  if (value === 1n || value === candidate - 1n) return true;
  for (let round = 1; round < powersOfTwo; round++) {
    value = (value * value) % candidate;
    if (value === candidate - 1n) return true;
  }
  return false;
}

/** C's verdict agrees with verifyPrimes.ts, and a composite's evidence proves it. */
function expectAgreement(candidate: bigint) {
  const { verdict, evidence } = cVerdict(candidate);
  const expected: Verdict | "below-two" = candidate < 2n ? "below-two" : millerRabinVerdict(candidate);
  const context = `${candidate}: C says ${verdict}, TypeScript ${expected}`;
  if (verdict === "composite-by-factor") {
    assert.equal(expected, "composite", context);
    assert.ok(BASES.includes(evidence) && candidate % evidence === 0n && candidate !== evidence, `${context}: factor ${evidence}`);
  } else if (verdict === "composite-by-witness") {
    assert.equal(expected, "composite", context);
    assert.ok(BASES.includes(evidence) && !passesStrongTest(candidate, evidence), `${context}: witness ${evidence}`);
  } else {
    assert.equal(verdict, expected, context);
  }
}

// ── random values (fixed seed, so failures reproduce) ────────────────────

let randomState = 0x6a09_e667n;
function randomUint32(): bigint {
  // xorshift32
  randomState ^= (randomState << 13n) & 0xffffffffn;
  randomState ^= randomState >> 17n;
  randomState ^= (randomState << 5n) & 0xffffffffn;
  return randomState;
}

function randomBits(bits: number): bigint {
  let value = 0n;
  for (let produced = 0; produced < bits; produced += 32) value = (value << 32n) | randomUint32();
  return value & ((1n << BigInt(bits)) - 1n);
}

/** The first prime at or above `start`, by the TypeScript verifier. */
function nextPrimeFrom(start: bigint): bigint {
  for (let candidate = start | 1n; ; candidate += 2n) if (millerRabinVerdict(candidate) === "prime") return candidate;
}

// ── tests ─────────────────────────────────────────────────────────────────

describe("primality.c against verifyPrimes.ts", () => {
  it("agrees on random candidates from 1 to 82 bits, with evidence that proves every composite", () => {
    for (let round = 0; round < 20000; round++) {
      const candidate = randomBits(1 + (round % 82));
      expectAgreement(candidate);
      expectAgreement(candidate | 1n);
    }
  });

  it("proves random primes above 2^64 prime, up to the proven bound", () => {
    for (let round = 0; round < 300; round++) {
      const prime = nextPrimeFrom(TWO_TO_THE_64 + randomBits(65 + (round % 17)));
      if (prime >= A13) continue;
      assert.equal(cVerdict(prime).verdict, "prime", `${prime}`);
    }
  });

  it("catches products of two large primes above 2^64 with a witness (no small factor to find)", () => {
    for (let round = 0; round < 300; round++) {
      // 33 to 40 bits each: products from 2^64 up to just below a(13) (about 2^81.4)
      const first = nextPrimeFrom(randomBits(33 + (round % 8)) | (1n << 32n));
      const second = nextPrimeFrom(randomBits(33 + (round % 8)) | (1n << 32n));
      const product = first * second;
      if (product < TWO_TO_THE_64 || product >= A13) continue;
      const { verdict, evidence } = cVerdict(product);
      assert.equal(verdict, "composite-by-witness", `${first} · ${second}`);
      assert.ok(!passesStrongTest(product, evidence), `${first} · ${second}: witness ${evidence}`);
    }
  });

  it("leaves candidates past a(13) without a small factor pending, and agrees with TypeScript there", () => {
    for (let round = 0; round < 500; round++) {
      const candidate = A13 + randomBits(round % 2 === 0 ? 8 : 200);
      expectAgreement(candidate);
      if (BASES.every((base) => candidate % base !== 0n)) assert.equal(cVerdict(candidate).verdict, "beyond-proven-bound");
    }
    assert.equal(DETERMINISTIC_VERIFICATION_LIMIT, A13, "C and TypeScript use the same last bound");
  });

  it("agrees around 2^64 and the bounds a(12) and a(13), where the bases needed change", () => {
    for (const center of [TWO_TO_THE_64, A12, A13]) {
      for (let offset = -2000n; offset <= 2000n; offset++) expectAgreement(center + offset);
    }
  });

  it("checks that a(12) and a(13) really pass their first 12 and 13 bases", () => {
    for (const [bound, baseCount] of [[A12, 12], [A13, 13]] as const) {
      const count = writeCandidate(bound);
      for (const base of BASES.slice(0, baseCount)) {
        assert.equal(harness.harness_strong_probable_prime(count, Number(base)), 1, `${bound}, base ${base}`);
        assert.ok(passesStrongTest(bound, base), `reference: ${bound}, base ${base}`);
      }
    }
  });

  it("gives the same verdict and evidence by the uint64_t and multi-limb paths below 2^64", () => {
    for (let round = 0; round < 20000; round++) {
      const candidate = randomBits(1 + (round % 64));
      const fast = cVerdict(candidate);
      const multiLimb = cVerdict(candidate, "multi-limb");
      assert.deepEqual(fast, multiLimb, `${candidate}`);
    }
  });
});
