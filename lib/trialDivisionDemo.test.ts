import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { primalityTableBelow } from "./primes/sieveOfEratosthenes.ts";
import {
  TRIAL_DIVISION_DEMO_MAX,
  describeStep,
  parseTrialDivisionInput,
  squareRootToOneDecimal,
  trialDivision,
  trialDivisionConclusion,
} from "./trialDivisionDemo.ts";

const sentence = (value: number) => {
  const { before, number, after } = trialDivisionConclusion(trialDivision(value));
  return before + number + after;
};

describe("trialDivision", () => {
  it("agrees with the sieve on every number from 0 to 10,000, and finds the smallest factor", () => {
    const isPrime = primalityTableBelow(TRIAL_DIVISION_DEMO_MAX + 1);
    for (let value = 0; value <= TRIAL_DIVISION_DEMO_MAX; value++) {
      const { steps, factor } = trialDivision(value);
      if (value < 2 || isPrime[value]) {
        assert.equal(factor, null, `${value}`);
      } else {
        assert.notEqual(factor, null, `${value} is composite`);
        assert.equal(value % factor!, 0);
        for (let smaller = 2; smaller < factor!; smaller++) assert.notEqual(value % smaller, 0, `${smaller} divides ${value} first`);
      }
      // every step is a true division by a prime, in order, never past the square root
      let previous = 1;
      for (const step of steps) {
        assert.equal(isPrime[step.divisor], 1);
        assert.ok(step.divisor > previous);
        assert.ok(step.divisor * step.divisor <= value);
        assert.equal(step.quotient * step.divisor + step.remainder, value);
        assert.ok(step.remainder >= 0 && step.remainder < step.divisor);
        previous = step.divisor;
      }
      // a prime tries every prime up to its square root
      if (factor === null && value >= 2)
        assert.equal(steps.length, Array.from({ length: Math.floor(Math.sqrt(value)) + 1 }, (_, n) => n).filter((n) => isPrime[n]).length);
    }
    assert.equal(trialDivision(9_973).steps.length, 25); // the largest prime below 10,000: every prime below 100
  });

  it("refuses numbers outside its range", () => {
    assert.throws(() => trialDivision(TRIAL_DIVISION_DEMO_MAX + 1), RangeError);
    assert.throws(() => trialDivision(-1), RangeError);
    assert.throws(() => trialDivision(2.5), RangeError);
  });
});

describe("the demo's words", () => {
  it("describes each division", () => {
    assert.equal(describeStep(97, trialDivision(97).steps[3]), "97 ÷ 7 = 13, remainder 6");
    assert.equal(describeStep(10_000, trialDivision(10_000).steps[0]), "10,000 ÷ 2 = 5,000, remainder 0");
  });

  it("concludes as the page says", () => {
    assert.equal(sentence(97), "None of the primes up to √97 ≈ 9.8 divides it, so 97 is prime.");
    assert.equal(sentence(91), "7 divides 91 evenly: 91 = 7 × 13, so 91 isn’t prime.");
    assert.equal(sentence(221), "13 divides 221 evenly: 221 = 13 × 17, so 221 isn’t prime.");
    assert.equal(sentence(3), "No prime is at or below √3 ≈ 1.7, so there’s nothing to try: 3 is prime.");
    assert.equal(sentence(2), "No prime is at or below √2 ≈ 1.4, so there’s nothing to try: 2 is prime.");
    assert.equal(sentence(1), "1 isn’t prime: primes start at 2.");
    assert.equal(sentence(0), "0 isn’t prime: primes start at 2.");
    assert.equal(sentence(9_973), "None of the primes up to √9,973 ≈ 99.8 divides it, so 9,973 is prime.");
  });

  it("rounds the square root down, so it never reaches a prime it didn't try", () => {
    assert.equal(squareRootToOneDecimal(97), "9.8");
    assert.equal(squareRootToOneDecimal(99), "9.9"); // 9.9498…, which rounding would make 9.9 too
    assert.equal(squareRootToOneDecimal(9_999), "99.9"); // 99.995: rounding would say 100.0
  });
});

describe("parseTrialDivisionInput", () => {
  it("reads whole numbers, with separators and leading zeros", () => {
    assert.deepEqual(parseTrialDivisionInput(" 97 "), { kind: "number", value: 97 });
    assert.deepEqual(parseTrialDivisionInput("10,000"), { kind: "number", value: 10_000 });
    assert.deepEqual(parseTrialDivisionInput("1 001"), { kind: "number", value: 1_001 });
    assert.deepEqual(parseTrialDivisionInput("0007"), { kind: "number", value: 7 });
    assert.deepEqual(parseTrialDivisionInput("0"), { kind: "number", value: 0 });
  });

  it("sends anything past 10,000 to the checker, at any size", () => {
    assert.deepEqual(parseTrialDivisionInput("10,001"), { kind: "too-big", digits: "10001" });
    const huge = "9".repeat(400);
    assert.deepEqual(parseTrialDivisionInput(huge), { kind: "too-big", digits: huge });
    assert.deepEqual(parseTrialDivisionInput("000010001"), { kind: "too-big", digits: "10001" });
  });

  it("refuses anything that isn't a whole number", () => {
    for (const typed of ["", "  ", "-7", "9.5", "12a", "1e3", "+5"]) assert.deepEqual(parseTrialDivisionInput(typed), { kind: "invalid" }, typed);
  });
});
