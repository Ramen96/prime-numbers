import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SEGMENT_DEMO_FIRST_START,
  SEGMENT_DEMO_WINDOW_SIZE,
  segmentCaption,
  segmentCells,
  segmentWindow,
} from "./segmentDemo.ts";

const isPrime = (value: number) => {
  if (value < 2) return false;
  for (let divisor = 2; divisor * divisor <= value; divisor++) if (value % divisor === 0) return false;
  return true;
};
/** Windows from 100 to past 10,000. */
const WINDOWS = Array.from({ length: 500 }, (_, index) => segmentWindow(index));

describe("segmentDemo", () => {
  it("starts with the worked example: 100 to 119, base primes 2, 3, 5 and 7, leaving 101, 103, 107, 109 and 113", () => {
    const first = WINDOWS[0];
    assert.equal(first.low, 100);
    assert.equal(first.high, 120);
    assert.deepEqual(first.basePrimes, [2, 3, 5, 7]);
    assert.deepEqual(first.passes.map((pass) => pass.marks), [
      [100, 102, 104, 106, 108, 110, 112, 114, 116, 118],
      [102, 105, 108, 111, 114, 117],
      [100, 105, 110, 115],
      [105, 112, 119],
    ]);
    assert.deepEqual(first.survivors, [101, 103, 107, 109, 113]);
    assert.equal(first.steps, 5);
  });

  it("leaves exactly the primes in every window, from 100 to past 10,000", () => {
    for (const window of WINDOWS) {
      const primes = [];
      for (let value = window.low; value < window.high; value++) if (isPrime(value)) primes.push(value);
      assert.deepEqual(window.survivors, primes, `${window.low} to ${window.high - 1}`);
      assert.equal(window.high - window.low, SEGMENT_DEMO_WINDOW_SIZE);
    }
    assert.equal(WINDOWS.at(-1)!.high - 1, SEGMENT_DEMO_FIRST_START + 500 * 20 - 1);
  });

  it("starts each base prime at its first multiple in the window, never below its square, and marks every multiple after", () => {
    for (const window of WINDOWS) {
      for (const pass of window.passes) {
        const expected = [];
        for (let value = window.low; value < window.high; value++)
          if (value % pass.prime === 0 && value >= pass.prime * pass.prime) expected.push(value);
        assert.deepEqual(pass.marks, expected, `${pass.prime} in ${window.low}`);
        assert.equal(pass.remainder, window.low % pass.prime);
        assert.equal(pass.fromRemainder % pass.prime, 0);
        assert.ok(pass.fromRemainder >= window.low && pass.fromRemainder < window.low + pass.prime);
      }
    }
  });

  it("adds a base prime in the window that holds its square, and only then", () => {
    const joins = WINDOWS.filter((window) => window.joined.length > 0).map((window) => [window.low, window.joined]);
    // 2, 3, 5 and 7 are base primes from the first window on (their squares are below 100)
    assert.deepEqual(joins.slice(0, 5), [[120, [11]], [160, [13]], [280, [17]], [360, [19]], [520, [23]]]);
    for (const window of WINDOWS.slice(1)) {
      const previous = WINDOWS[window.index - 1];
      assert.deepEqual(window.basePrimes, [...previous.basePrimes, ...window.joined]);
      for (const prime of window.joined) assert.ok(prime * prime >= window.low && prime * prime < window.high);
    }
  });

  it("strikes a number once for every base prime that marks it, and only after that prime's step", () => {
    const first = WINDOWS[0];
    const at = (step: number, value: number) => segmentCells(first, step).find((cell) => cell.value === value)!;
    assert.deepEqual(at(0, 105).crossedBy, []);
    assert.deepEqual(at(2, 105).crossedBy.map((mark) => mark.prime), [3]);
    assert.deepEqual(at(4, 105).crossedBy.map((mark) => mark.prime), [3, 5, 7]);
    assert.equal(at(4, 105).justCrossed, true);
    assert.equal(at(4, 105).orderInStep, 0);
    assert.equal(at(4, 113).state, "standing");
    assert.equal(at(5, 113).state, "prime");
    assert.equal(at(5, 105).state, "crossed");
  });

  it("says what each step does, as the worked example does", () => {
    const first = WINDOWS[0];
    assert.equal(
      segmentCaption(first, 0),
      "The numbers 100 to 119. √119 is just under 11, so the base primes are 2, 3, 5 and 7. Press “Next step” to start with 2.",
    );
    assert.equal(
      segmentCaption(first, 2),
      "3: 100 mod 3 is 1, so its first multiple here is 102. Crossing off 102, 105, 108, 111, 114, 117 (6 numbers). 102, 108 and 114 were already crossed off, and are marked again: the sieve doesn’t check.",
    );
    assert.equal(segmentCaption(first, 5), "What’s left is prime: 101, 103, 107, 109 and 113.");
    assert.match(segmentCaption(WINDOWS[1], 0), /11² = 121 is inside it, so 11 joins the base primes: 2, 3, 5, 7 and 11\.$/);
    assert.match(segmentCaption(WINDOWS[2], 0), /The base primes are still 2, 3, 5, 7 and 11: 13² = 169 is past it\.$/);
  });

  it("says so when a base prime lands nowhere in the window", () => {
    const missed = WINDOWS.flatMap((window) =>
      window.passes.map((pass, index) => ({ window, pass, step: index + 1 })).filter(({ pass }) => pass.marks.length === 0),
    );
    assert.ok(missed.length > 0, "base primes past 20 sometimes miss a window");
    const { window, pass, step } = missed[0];
    assert.equal(
      segmentCaption(window, step),
      `${pass.prime}: ${window.low} mod ${pass.prime} is ${pass.remainder}, so its first multiple here is ${pass.fromRemainder}, past the window: nothing to cross off.`,
    );
  });
});
