import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIEVE_DEMO_LIMIT,
  SIEVE_DEMO_PRIMES,
  SIEVE_DEMO_STEPS,
  SIEVE_DEMO_SURVIVORS,
  sieveDemoCaption,
  sieveDemoCells,
} from "./sieveDemo.ts";

const isPrime = (value: number) => {
  if (value < 2) return false;
  for (let divisor = 2; divisor * divisor <= value; divisor++) if (value % divisor === 0) return false;
  return true;
};
const smallestFactor = (value: number) => {
  for (let divisor = 2; ; divisor++) if (value % divisor === 0) return divisor;
};

describe("sieveDemo", () => {
  it("sieves 1 to 120 with 2, 3, 5 and 7, then one step to finish", () => {
    assert.deepEqual(SIEVE_DEMO_PRIMES, [2, 3, 5, 7]);
    assert.equal(SIEVE_DEMO_STEPS, 5);
    assert.equal(SIEVE_DEMO_SURVIVORS.length, 30);
    assert.deepEqual(SIEVE_DEMO_SURVIVORS, Array.from({ length: SIEVE_DEMO_LIMIT }, (_, index) => index + 1).filter(isPrime));
  });

  it("starts with nothing crossed off, and 1 marked as not prime", () => {
    const cells = sieveDemoCells(0);
    assert.equal(cells.length, SIEVE_DEMO_LIMIT);
    assert.deepEqual(cells[0], { value: 1, state: "not-prime", crossedOutBy: null, colorIndex: null, justCrossed: false, orderInStep: 0 });
    assert.ok(cells.slice(1).every((cell) => cell.state === "standing"));
  });

  it("after each step, has crossed off exactly the composites whose smallest factor has had its step", () => {
    for (let step = 0; step <= SIEVE_DEMO_STEPS; step++) {
      for (const cell of sieveDemoCells(step).slice(1)) {
        const factor = isPrime(cell.value) ? null : smallestFactor(cell.value);
        const factorStep = factor === null ? Infinity : SIEVE_DEMO_PRIMES.indexOf(factor) + 1;
        if (factorStep <= step) {
          assert.equal(cell.state, "crossed", `${cell.value} after step ${step}`);
          assert.equal(cell.crossedOutBy, factor);
          assert.equal(cell.justCrossed, factorStep === step);
        } else {
          assert.notEqual(cell.state, "crossed", `${cell.value} after step ${step}`);
        }
      }
    }
  });

  it("marks each sieving prime from its step on, and every survivor as prime only at the end", () => {
    for (let step = 0; step <= SIEVE_DEMO_STEPS; step++) {
      const cells = sieveDemoCells(step);
      SIEVE_DEMO_PRIMES.forEach((prime, index) =>
        assert.equal(cells[prime - 1].state, index < step ? "sieving-prime" : "standing", `${prime} after step ${step}`),
      );
      const primesShown = cells.filter((cell) => cell.state === "prime").map((cell) => cell.value);
      assert.deepEqual(primesShown, step === SIEVE_DEMO_STEPS ? SIEVE_DEMO_SURVIVORS.filter((prime) => prime > 7) : []);
    }
  });

  it("numbers the cells crossed off in a step in order, for the stagger", () => {
    const crossedBySeven = sieveDemoCells(4).filter((cell) => cell.justCrossed);
    assert.deepEqual(crossedBySeven.map((cell) => cell.value), [49, 77, 91, 119]);
    assert.deepEqual(crossedBySeven.map((cell) => cell.orderInStep), [0, 1, 2, 3]);
  });

  it("says what each step does", () => {
    assert.match(sieveDemoCaption(0), /none crossed off yet/);
    assert.equal(
      sieveDemoCaption(1),
      "2 is the next number not crossed off, so it’s prime. Crossing off its multiples from 2² = 4: 4, 6, 8, 10, 12, …, 120 (59 numbers).",
    );
    assert.equal(
      sieveDemoCaption(4),
      "7 is the next number not crossed off, so it’s prime. Crossing off its multiples from 7² = 49 that are still standing: 49, 77, 91, 119 (4 numbers). The others, like 56 and 63, were already crossed off by 2 and 3.",
    );
    assert.equal(sieveDemoCaption(5), "11² = 121 is past 120, so everything left is prime: 30 primes.");
  });
});
