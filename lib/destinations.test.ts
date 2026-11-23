import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPrime, nextPrimeAfter } from "../tests/support/primality.ts";
import { DESTINATIONS, LISTED_DESTINATIONS, RANDOM_DESTINATIONS, destinationAt, pickDestination } from "./destinations.ts";
import { listedNumber } from "./listedNumbers.ts";
import { DETERMINISTIC_VERIFICATION_LIMIT } from "./primes/verifyPrimes.ts";

const at = (value: bigint) => destinationAt(value)!;

describe("the destinations", () => {
  it("are in order, once each", () => {
    for (let index = 1; index < DESTINATIONS.length; index++) assert.ok(DESTINATIONS[index - 1].value < DESTINATIONS[index].value);
  });

  it("hold the facts their names claim", () => {
    assert.equal(nextPrimeAfter(1_000_000n), 1_000_003n); // the first prime after a million
    assert.ok(isPrime(8_675_309n) && isPrime(8_675_311n)); // twin primes
    assert.ok(isPrime(10n ** 9n + 7n) && at(10n ** 9n + 7n).value === 1_000_000_007n);
    assert.ok(isPrime(at(2n ** 31n - 1n).value));
    // 2⁵³: JavaScript numbers stop being exact
    assert.equal(at(2n ** 53n).value, 9_007_199_254_740_992n);
    assert.equal(2 ** 53 + 1, 2 ** 53);
    assert.ok(Number.isSafeInteger(2 ** 53 - 1) && !Number.isSafeInteger(2 ** 53));
    assert.ok(isPrime(2n ** 61n - 1n) && isPrime(2n ** 89n - 1n) && isPrime(2n ** 127n - 1n));
    // the gap of 1,550 straight after its prime
    const gapStart = 18_361_375_334_787_046_697n;
    assert.ok(isPrime(gapStart) && at(gapStart));
    assert.equal(nextPrimeAfter(gapStart) - gapStart, 1_550n);
    // the largest prime in 64 bits
    assert.ok(isPrime(2n ** 64n - 59n));
    assert.equal(nextPrimeAfter(2n ** 64n - 59n) > 2n ** 64n, true);
    // the first 38 digits of π
    assert.equal(at(31_415_926_535_897_932_384_626_433_832_795_028_841n).value.toString(), "31415926535897932384626433832795028841");
    assert.equal(nextPrimeAfter(10n ** 100n), 10n ** 100n + 267n);
    assert.ok(at(10n ** 100n + 267n) && at(2n ** 521n - 1n));
  });

  it("starts proofs where the site does: a(13)", () => {
    const proofsBegin = DESTINATIONS.find((destination) => destination.name === "where every prime starts needing a certificate")!;
    assert.equal(proofsBegin.value, DETERMINISTIC_VERIFICATION_LIMIT);
  });

  it("take their lines from the listed numbers' notes wherever one exists", () => {
    for (const destination of LISTED_DESTINATIONS) {
      const note = listedNumber(destination.value)?.note;
      if (note) assert.equal(destination.note, note, destination.label);
      else assert.ok(destination.note.length > 0, `${destination.label} needs a line of its own`);
    }
  });

  it("list every place but the hidden ones on /fun-facts, and never pick a slow one at random", () => {
    assert.deepEqual(
      DESTINATIONS.filter((destination) => destination.hidden).map((destination) => destination.value),
      [359n, 314_159n],
    );
    assert.equal(LISTED_DESTINATIONS.length, DESTINATIONS.length - 2);
    assert.ok(RANDOM_DESTINATIONS.every((destination) => !destination.slow));
    assert.deepEqual(
      DESTINATIONS.filter((destination) => destination.slow).map((destination) => destination.label),
      ["10¹⁰⁰ + 267", "2⁵²¹ − 1"],
    );
    assert.ok(RANDOM_DESTINATIONS.some((destination) => destination.hidden)); // the easter eggs are in the pool
  });
});

describe("pickDestination", () => {
  it("covers the whole pool, and never the place it was just at", () => {
    const pool = RANDOM_DESTINATIONS.length;
    const picks = Array.from({ length: pool - 1 }, (_, index) => pickDestination(null, () => index / (pool - 1)).value);
    assert.equal(new Set(picks).size, pool - 1);
    assert.equal(pickDestination(null, () => 0.999_999).value, RANDOM_DESTINATIONS.at(-1)!.value);
    for (const current of RANDOM_DESTINATIONS)
      for (const random of [0, 0.5, 0.999_999]) assert.notEqual(pickDestination(current.value, () => random).value, current.value);
  });
});
