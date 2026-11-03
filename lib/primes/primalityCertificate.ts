// The independent checker for primality certificates (CLAUDE.md, Requirement
// A3, Phase 5). Whatever finds a certificate, only this decides whether to
// believe it: it shares no code with the C prover, and is meant to be small
// enough to read and check by hand.
//
// A certificate is a chain of steps in the style of Goldwasser–Kilian and
// Atkin–Morain. One step says: on the curve y² = x³ + ax + b mod N, the point
// Q has order q. If that holds, and q is prime, take any prime factor p of N.
// Modulo p, Q still has order exactly q, so the curve mod p has at least q
// points, and by Hasse's theorem q ≤ (√p + 1)². So if q > (N^¼ + 1)², then
// p > √N for every prime factor p, which only a prime N allows.
//
// That reduces proving N to proving q, a smaller number. The chain ends at a
// number below a(13), where deterministic Miller–Rabin is already a proof.

import { millerRabinVerdict } from "./verifyPrimes.ts";

/** One step: "on this curve mod `number`, this point has order `orderPrime`". */
export interface CertificateStep {
  number: bigint;
  curveA: bigint;
  curveB: bigint;
  pointX: bigint;
  pointY: bigint;
  orderPrime: bigint;
}

export type CertificateCheck = { valid: true } | { valid: false; number: bigint; reason: string };

interface CurvePoint {
  x: bigint;
  y: bigint;
}
/** The point at infinity, modulo every prime factor at once. */
const IDENTITY = "identity";
/**
 * An operation that can't be trusted: a denominator with no inverse, or points
 * alike modulo some factors but not others. It can only mean N is composite.
 */
const UNDEFINED = "undefined";
type CurveResult = CurvePoint | typeof IDENTITY | typeof UNDEFINED;

function modulo(value: bigint, modulus: bigint): bigint {
  const remainder = value % modulus;
  return remainder < 0n ? remainder + modulus : remainder;
}

/** The inverse of `value` mod `modulus`, by the extended Euclidean algorithm, or null if there's none. */
function inverse(value: bigint, modulus: bigint): bigint | null {
  let [remainder, nextRemainder] = [modulus, modulo(value, modulus)];
  let [coefficient, nextCoefficient] = [0n, 1n];
  while (nextRemainder !== 0n) {
    const quotient = remainder / nextRemainder;
    [remainder, nextRemainder] = [nextRemainder, remainder - quotient * nextRemainder];
    [coefficient, nextCoefficient] = [nextCoefficient, coefficient - quotient * nextCoefficient];
  }
  return remainder === 1n ? modulo(coefficient, modulus) : null;
}

/**
 * first + second on the curve, in affine coordinates, modulo N. N may be
 * composite, which is why this is careful: a result is only returned if the
 * formula is valid modulo every prime factor of N, so it's right modulo each.
 */
export function addPoints(first: CurvePoint, second: CurvePoint, curveA: bigint, n: bigint): CurveResult {
  let numerator: bigint;
  let denominator: bigint;
  if (first.x === second.x) {
    if (modulo(first.y + second.y, n) === 0n) return IDENTITY;
    if (first.y !== second.y) return UNDEFINED;
    numerator = 3n * first.x * first.x + curveA;
    denominator = 2n * first.y;
  } else {
    numerator = second.y - first.y;
    denominator = second.x - first.x;
  }
  const denominatorInverse = inverse(denominator, n);
  if (denominatorInverse === null) return UNDEFINED;
  const slope = modulo(numerator * denominatorInverse, n);
  const x = modulo(slope * slope - first.x - second.x, n);
  return { x, y: modulo(slope * (first.x - x) - first.y, n) };
}

/**
 * Whether `order`·point is the identity, with no earlier multiple along the
 * way being the identity or undefined. Double and add, from the top bit.
 */
function hasOrder(point: CurvePoint, order: bigint, curveA: bigint, n: bigint): boolean {
  let running: CurveResult = point;
  for (const bit of order.toString(2).slice(1)) {
    if (typeof running === "string") return false; // only the very last operation may reach the identity
    running = addPoints(running, running, curveA, n);
    if (bit === "1") {
      if (typeof running === "string") return false;
      running = addPoints(running, point, curveA, n);
    }
  }
  return running === IDENTITY;
}

/** floor(√value), by Newton's method. */
function floorSquareRoot(value: bigint): bigint {
  if (value < 2n) return value;
  let estimate = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const better = (estimate + value / estimate) >> 1n;
    if (better >= estimate) return estimate;
    estimate = better;
  }
}

/**
 * Whether q > (N^¼ + 1)², which is (√q − 1)⁴ > N, in integers. It rounds √q
 * down, so it may refuse a q right at the edge, but never accepts one below it.
 */
export function orderIsLargeEnough(orderPrime: bigint, n: bigint): boolean {
  const rootBelow = floorSquareRoot(orderPrime) - 1n;
  return rootBelow > 0n && rootBelow ** 4n > n;
}

/** Why this step doesn't hold, or null if it does (given that its orderPrime is prime). */
function stepProblem({ number: n, curveA, curveB, pointX, pointY, orderPrime }: CertificateStep): string | null {
  if (n < 5n || n % 2n === 0n || n % 3n === 0n) return "the number shares a factor with 6";
  for (const value of [curveA, curveB, pointX, pointY]) {
    if (value < 0n || value >= n) return "a curve value is out of range";
  }
  const discriminant = modulo(4n * curveA ** 3n + 27n * curveB ** 2n, n);
  if (inverse(discriminant, n) === null) return "the curve is singular modulo a factor";
  const rightSide = pointX ** 3n + curveA * pointX + curveB;
  if (modulo(pointY ** 2n - rightSide, n) !== 0n) return "the point isn't on the curve";
  if (!orderIsLargeEnough(orderPrime, n)) return "the order is too small to prove anything";
  if (!hasOrder({ x: pointX, y: pointY }, orderPrime, curveA, n)) return "the point doesn't have that order";
  return null;
}

/**
 * Whether `steps` prove `candidate` prime. Each step's orderPrime must be the
 * next step's number, and the last must be proven by deterministic Miller–Rabin,
 * which refuses anything past a(13). With no steps, the candidate itself must be.
 */
export function checkCertificate(candidate: bigint, steps: readonly CertificateStep[]): CertificateCheck {
  let current = candidate;
  for (const step of steps) {
    if (step.number !== current) return { valid: false, number: step.number, reason: "the chain is broken" };
    const problem = stepProblem(step);
    if (problem !== null) return { valid: false, number: current, reason: problem };
    current = step.orderPrime;
  }
  if (millerRabinVerdict(current) !== "prime") {
    return { valid: false, number: current, reason: "the chain doesn't end at a number proven prime" };
  }
  return { valid: true };
}
