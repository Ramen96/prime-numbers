import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cryptoRandomWords, randomBelow, randomNumberWithDigits, type RandomWords } from "./randomStart.ts";

/** A source that hands out the given words in turn (as many as each draw asks for). */
function scriptedWords(values: number[]): RandomWords & { calls: number[] } {
  let next = 0;
  const calls: number[] = [];
  const source = (words: Uint32Array) => {
    calls.push(words.length);
    for (let index = 0; index < words.length; index++) words[index] = values[next++ % values.length];
  };
  return Object.assign(source, { calls });
}

describe("randomNumberWithDigits", () => {
  it("has exactly the digits asked for, from 1 to 300 and far beyond", () => {
    for (const digits of [...Array.from({ length: 300 }, (_, index) => index + 1), 1000, 10_000]) {
      for (let sample = 0; sample < (digits <= 300 ? 20 : 3); sample++) {
        assert.equal(randomNumberWithDigits(digits).toString().length, digits, `${digits} digits`);
      }
    }
  });

  it("reaches both ends of the range", () => {
    assert.equal(randomNumberWithDigits(3, scriptedWords([0])), 100n);
    // 899 is the largest value below 900, and its 10 bits are all that's kept
    assert.equal(randomNumberWithDigits(3, scriptedWords([899])), 999n);
    assert.equal(randomNumberWithDigits(1, scriptedWords([8])), 9n);
  });

  it("gives every leading digit about equally often", () => {
    const counts = new Array<number>(10).fill(0);
    const samples = 18_000;
    for (let sample = 0; sample < samples; sample++) counts[Number(randomNumberWithDigits(40).toString()[0])]++;
    assert.equal(counts[0], 0);
    // 2,000 expected for each of 1 to 9; ±15% is over 9 standard deviations
    for (let digit = 1; digit <= 9; digit++) assert.ok(Math.abs(counts[digit] - 2000) < 300, `${digit}: ${counts[digit]}`);
  });

  it("refuses anything but a whole number of digits from 1 up", () => {
    for (const digits of [0, -1, 1.5, Number.NaN, Infinity]) assert.throws(() => randomNumberWithDigits(digits), RangeError);
  });
});

describe("randomBelow", () => {
  it("draws again when a value isn't below the limit, so every value is equally likely", () => {
    // limit 5: 3 bits, so 5, 6 and 7 are drawn again
    const source = scriptedWords([7, 5, 6, 4]);
    assert.equal(randomBelow(5n, source), 4n);
    assert.deepEqual(source.calls, [1, 1, 1, 1]);
  });

  it("keeps only the bits the limit needs, so a draw rarely fails", () => {
    // 0xffffffff with only 3 bits kept is 7, past 5; then 0xfffffffc keeps 4
    assert.equal(randomBelow(5n, scriptedWords([0xffff_ffff, 0xffff_fffc])), 4n);
    // exactly 32 bits: nothing is cleared
    assert.equal(randomBelow(2n ** 32n, scriptedWords([0xffff_ffff])), 2n ** 32n - 1n);
  });

  it("puts words together least significant first", () => {
    assert.equal(randomBelow(2n ** 64n, scriptedWords([1, 2])), (2n << 32n) | 1n);
  });

  it("is uniform over a small range", () => {
    const counts = new Array<number>(6).fill(0);
    for (let sample = 0; sample < 12_000; sample++) counts[Number(randomBelow(6n))]++;
    for (const count of counts) assert.ok(Math.abs(count - 2000) < 300, String(counts));
  });

  it("returns 0 for a limit of 1, and refuses a limit of 0 or less", () => {
    assert.equal(randomBelow(1n), 0n);
    assert.throws(() => randomBelow(0n), RangeError);
    assert.throws(() => randomBelow(-3n), RangeError);
  });
});

describe("cryptoRandomWords", () => {
  it("fills arrays larger than getRandomValues takes at once (65,536 bytes)", () => {
    const words = new Uint32Array(50_000);
    cryptoRandomWords(words);
    // every piece was filled: the last few thousand words aren't left at 0
    assert.ok(words.subarray(45_000).some((word) => word !== 0));
    assert.ok(randomNumberWithDigits(200_000).toString().length === 200_000);
  });
});
