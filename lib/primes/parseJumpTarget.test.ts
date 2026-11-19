import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseJumpTarget, TOO_MANY_DIGITS_MESSAGE } from "./parseJumpTarget.ts";

function messageFor(userInput: string): string | null {
  const result = parseJumpTarget(userInput);
  return result.valid ? null : result.message;
}

describe("parseJumpTarget", () => {
  it("reads whole numbers, with the usual digit separators", () => {
    for (const userInput of ["1000000", "1,000,000", "1_000_000", "1 000 000", " 1000000 "])
      assert.deepEqual(parseJumpTarget(userInput), { valid: true, target: 1_000_000n }, userInput);
  });

  it("explains what's wrong with anything else", () => {
    assert.equal(messageFor(""), "Type a number to jump to.");
    assert.equal(messageFor(" , "), "Type a number to jump to.");
    assert.equal(messageFor("-7"), "Primes start at 2. Nothing down there.");
    assert.equal(messageFor("2.5"), "Whole numbers only. Primes don’t do fractions.");
    assert.equal(messageFor("1e9"), "That doesn’t look like a number.");
  });

  it("reads a number of a million digits exactly", () => {
    const digits = "7" + "0".repeat(999_998) + "3";
    const result = parseJumpTarget(digits);
    assert.ok(result.valid);
    assert.equal(result.target.toString(), digits);
  });

  it("says so, instead of throwing, past the longest BigInt the browser can hold", () => {
    // 2^30 bits in V8 (Node and Chromium) is 323,228,496 digits; this is one more.
    // About 0.2 s, but a few hundred MB while it runs.
    assert.equal(messageFor("1" + "0".repeat(323_228_496)), TOO_MANY_DIGITS_MESSAGE);
  });
});
