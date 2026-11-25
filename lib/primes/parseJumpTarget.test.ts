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
      assert.deepEqual(parseJumpTarget(userInput), { valid: true, target: 1_000_000n, written: null }, userInput);
  });

  it("explains what's wrong with anything else", () => {
    assert.equal(messageFor(""), "Type a number to jump to.");
    assert.equal(messageFor(" , "), "Type a number to jump to.");
    assert.equal(messageFor("-7"), "Primes start at 2. Nothing down there.");
    assert.equal(messageFor("2.5"), "Whole numbers only. Primes don’t do fractions.");
    assert.equal(messageFor("1e9x"), "That doesn’t look like a number. Try 1,000,003, 1e100 or 2^127 − 1.");
    assert.equal(messageFor("1.25e1"), "Whole numbers only. Primes don’t do fractions.");
    assert.equal(messageFor("1,000e3"), "Commas only go in plain numbers, like 1,000,003.");
    assert.equal(messageFor("0^0"), "0⁰ has no agreed value, so there’s nothing to jump to.");
    assert.equal(messageFor("10^1000000000"), "That has 1,000,000,001 digits: more than this browser can hold as one number.");
    assert.equal(messageFor("2^2000000000"), "That has about 602,059,992 digits: more than this browser can hold as one number.");
    assert.equal(messageFor(`3^1${"0".repeat(400)}`), TOO_MANY_DIGITS_MESSAGE);
  });

  it("reads scientific notation and powers, saying how they were written", () => {
    assert.deepEqual(parseJumpTarget("1e100"), { valid: true, target: 10n ** 100n, written: "1e100" });
    assert.deepEqual(parseJumpTarget("2^127 − 1"), { valid: true, target: 2n ** 127n - 1n, written: "2^127-1" });
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
