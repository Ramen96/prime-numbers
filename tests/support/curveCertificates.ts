// Builds real primality certificates for testing the checker, standing in for
// the C prover until it exists, with its own arithmetic. It uses the curves
// y² = x³ + ax, whose possible orders mod p are known when p = s² + t²:
// p + 1 ± 2s and p + 1 ± 2t. Chains are built upward, choosing each prime so its
// curve order is known, so it reaches whichever primes it lands on: fine for a
// test, and no use for proving a given prime, which is the C prover's job.

import type { CertificateStep } from "../../lib/primes/primalityCertificate.ts";
import { isPrime } from "./primality.ts";

function powerMod(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  base %= modulus;
  for (let rest = exponent; rest > 0n; rest >>= 1n) {
    if (rest & 1n) result = (result * base) % modulus;
    base = (base * base) % modulus;
  }
  return result;
}

const mod = (value: bigint, p: bigint) => ((value % p) + p) % p;
const invert = (value: bigint, p: bigint) => powerMod(mod(value, p), p - 2n, p);

function integerRoot(value: bigint): bigint {
  let estimate = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const better = (estimate + value / estimate) >> 1n;
    if (better >= estimate) return estimate;
    estimate = better;
  }
}

/** s and t with p = s² + t², for prime p ≡ 1 mod 4, by Cornacchia's algorithm. */
function asTwoSquares(p: bigint): [bigint, bigint] {
  let nonResidue = 2n;
  while (powerMod(nonResidue, (p - 1n) / 2n, p) !== p - 1n) nonResidue++;
  let [a, b] = [p, powerMod(nonResidue, (p - 1n) / 4n, p)];
  while (b * b >= p) [a, b] = [b, a % b];
  return [b, integerRoot(p - b * b)];
}

/** A square root mod prime p, by Tonelli–Shanks, or null if value isn't a square. */
function squareRootMod(value: bigint, p: bigint): bigint | null {
  if (value === 0n) return 0n;
  if (powerMod(value, (p - 1n) / 2n, p) !== 1n) return null;
  let [oddPart, twos] = [p - 1n, 0n];
  while ((oddPart & 1n) === 0n) [oddPart, twos] = [oddPart >> 1n, twos + 1n];
  let nonResidue = 2n;
  while (powerMod(nonResidue, (p - 1n) / 2n, p) !== p - 1n) nonResidue++;
  let [m, c, t, r] = [twos, powerMod(nonResidue, oddPart, p), powerMod(value, oddPart, p), powerMod(value, (oddPart + 1n) / 2n, p)];
  while (t !== 1n) {
    let [i, power] = [0n, t];
    while (power !== 1n) [power, i] = [(power * power) % p, i + 1n];
    const factor = powerMod(c, 1n << (m - i - 1n), p);
    [m, c, t, r] = [i, (factor * factor) % p, (((t * factor) % p) * factor) % p, (r * factor) % p];
  }
  return r;
}

type Point = { x: bigint; y: bigint } | null; // null is the identity

function add(first: Point, second: Point, a: bigint, p: bigint): Point {
  if (first === null) return second;
  if (second === null) return first;
  if (first.x === second.x && mod(first.y + second.y, p) === 0n) return null;
  const slope =
    first.x === second.x
      ? mod((3n * first.x * first.x + a) * invert(2n * first.y, p), p)
      : mod((second.y - first.y) * invert(second.x - first.x, p), p);
  const x = mod(slope * slope - first.x - second.x, p);
  return { x, y: mod(slope * (first.x - x) - first.y, p) };
}

export function scalePoint(scalar: bigint, point: Point, a: bigint, p: bigint): Point {
  let [result, running]: [Point, Point] = [null, point];
  for (let rest = scalar; rest > 0n; rest >>= 1n) {
    if (rest & 1n) result = add(result, running, a, p);
    running = add(running, running, a, p);
  }
  return result;
}

function largeEnough(q: bigint, n: bigint): boolean {
  const root = integerRoot(q) - 1n;
  return root > 0n && root ** 4n > n;
}

/** A point of order q on some y² = x³ + ax mod p whose order is order = k·q, or null. */
function pointOfOrder(p: bigint, order: bigint, q: bigint): CertificateStep | null {
  const k = order / q;
  for (let a = 1n; a < 40n; a++) {
    for (let x = 1n; x < 8n; x++) {
      const y = squareRootMod(mod(x ** 3n + a * x, p), p);
      if (y === null || y === 0n) continue;
      const point = scalePoint(k, { x, y }, a, p);
      if (point !== null && scalePoint(q, point, a, p) === null) {
        return { number: p, curveA: a, curveB: 0n, pointX: point.x, pointY: point.y, orderPrime: q };
      }
    }
  }
  return null;
}

// A fixed seed, so a failure reproduces.
let randomState = 0x1f83_d9abn;
function randomBits(bits: number): bigint {
  let value = 0n;
  for (let produced = 0; produced < bits; produced += 32) {
    randomState ^= (randomState << 13n) & 0xffffffffn;
    randomState ^= randomState >> 17n;
    randomState ^= (randomState << 5n) & 0xffffffffn;
    value = (value << 32n) | randomState;
  }
  return value & ((1n << BigInt(bits)) - 1n);
}

/**
 * One step up: from a prime q = u² + v², a larger prime p whose curve has order
 * k·q. Multiplying u + vi by a random c + di gives (s − 1) + ti, so that
 * (s − 1)² + t² = k·q with k = c² + d², and p = s² + t² has p + 1 − 2s = k·q.
 */
function stepUp(q: bigint, multiplierBits: number): CertificateStep {
  const [u, v] = asTwoSquares(q);
  for (;;) {
    const [c, d] = [randomBits(multiplierBits), randomBits(multiplierBits)];
    const [sMinusOne, t] = [u * c - v * d, u * d + v * c];
    const s = sMinusOne + 1n;
    const p = s * s + t * t;
    if (p % 2n === 0n || !largeEnough(q, p) || !isPrime(p)) continue;
    const step = pointOfOrder(p, (c * c + d * d) * q, q);
    if (step !== null) return step;
  }
}

/** A prime at or past `start`, with a certificate: a chain built upward from just past 2^64. */
export function certifiedPrimeFrom(start: bigint): { prime: bigint; steps: CertificateStep[] } {
  let prime = 2n ** 64n + 1n;
  while (prime % 4n !== 1n || !isPrime(prime)) prime += 2n;
  const steps: CertificateStep[] = [];
  while (prime < start) {
    const bits = prime.toString(2).length;
    const step = stepUp(prime, Math.max(4, Math.min(Math.floor(bits / 4) - 2, Math.ceil((start.toString(2).length - bits) / 2) + 2)));
    steps.unshift(step);
    prime = step.number;
  }
  return { prime, steps };
}
