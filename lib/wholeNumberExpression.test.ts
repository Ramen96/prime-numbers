import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LARGEST_BIGINT_BITS, readWholeNumber, shortestWriting, type WholeNumberProblem } from "./wholeNumberExpression.ts";

function valueOf(userInput: string): bigint {
  const reading = readWholeNumber(userInput);
  if (!reading.valid) assert.fail(`${userInput} should read, got ${reading.problem.kind}`);
  return reading.value;
}

function problemWith(userInput: string): WholeNumberProblem {
  const reading = readWholeNumber(userInput);
  assert.ok(!reading.valid, `${userInput} should be refused`);
  return reading.problem;
}

describe("readWholeNumber", () => {
  it("reads plain numbers as before, with their digit separators, and says they were plain", () => {
    for (const userInput of ["1000000", "1,000,000", "1_000_000", "1 000 000", " 1000000 "])
      assert.deepEqual(readWholeNumber(userInput), { valid: true, value: 1_000_000n, written: null }, userInput);
    assert.equal(valueOf("9007199254740993"), 2n ** 53n + 1n);
    assert.equal(valueOf("0"), 0n);
  });

  it("reads scientific notation exactly, never through a double", () => {
    assert.equal(valueOf("1e100"), 10n ** 100n);
    assert.equal(valueOf("1E100"), 10n ** 100n);
    // a double would give 99,999,999,999,999,991,611,392
    assert.equal(valueOf("1e23"), 10n ** 23n);
    assert.equal(valueOf("3e50"), 3n * 10n ** 50n);
    assert.equal(valueOf("1.5e3"), 1500n);
    assert.equal(valueOf("1.5e+3"), 1500n);
    assert.equal(valueOf(".5e1"), 5n);
    assert.equal(valueOf("5.e2"), 500n);
    assert.equal(valueOf("1e0"), 1n);
    assert.equal(valueOf("0e5"), 0n);
    assert.equal(valueOf("0.0e-7"), 0n);
    assert.equal(valueOf("12.3456789012345678901234567890e30"), 123456789012345678901234567890n * 100n);
  });

  it("takes a negative exponent only when it leaves a whole number", () => {
    assert.equal(valueOf("1000e-3"), 1n);
    assert.equal(valueOf("1500e-2"), 15n);
    assert.equal(valueOf("120.0e-1"), 12n);
    for (const userInput of ["1500e-3", "1e-1", "1.25e1", "15e-1", "1e-99999999999999999999"])
      assert.deepEqual(problemWith(userInput), { kind: "fraction" }, userInput);
  });

  it("reads powers, written with ^, ** or superscripts", () => {
    assert.equal(valueOf("2^127"), 2n ** 127n);
    assert.equal(valueOf("10^100"), 10n ** 100n);
    assert.equal(valueOf("2**64"), 2n ** 64n);
    assert.equal(valueOf("10¹⁰⁰"), 10n ** 100n);
    assert.equal(valueOf("2⁶⁴"), 2n ** 64n);
    assert.equal(valueOf("7^0"), 1n);
    assert.equal(valueOf("0^5"), 0n);
    assert.equal(valueOf("1^-3"), 1n);
  });

  it("adds and subtracts terms, and keeps the expression as read, in ASCII", () => {
    assert.deepEqual(readWholeNumber("2^127 - 1"), { valid: true, value: 2n ** 127n - 1n, written: "2^127-1" });
    assert.deepEqual(readWholeNumber("2¹²⁷ − 1"), { valid: true, value: 2n ** 127n - 1n, written: "2^127-1" });
    assert.deepEqual(readWholeNumber("10^100 + 7"), { valid: true, value: 10n ** 100n + 7n, written: "10^100+7" });
    assert.equal(valueOf("1e3+1e3-1"), 1999n);
    assert.equal(valueOf("2^64 - 2^32 + 1"), 2n ** 64n - 2n ** 32n + 1n);
    assert.equal(valueOf("-1 + 10"), 9n);
    assert.equal(valueOf("+5"), 5n);
    assert.equal(valueOf("10 - 10"), 0n);
  });

  it("ignores spaces anywhere", () => {
    for (const userInput of ["1 e 100", " 1e100 ", "1\te100", "1 0 ^ 1 0 0"]) assert.equal(valueOf(userInput), 10n ** 100n, userInput);
    assert.equal(valueOf(" 2 ^ 1 2 7 - 1 "), 2n ** 127n - 1n);
  });

  it("says what's wrong with anything else", () => {
    assert.deepEqual(problemWith(""), { kind: "empty" });
    assert.deepEqual(problemWith(" , "), { kind: "empty" });
    for (const userInput of ["-7", "-2.5", "10 - 20", "-2^3", "0 - 1"]) assert.deepEqual(problemWith(userInput), { kind: "negative" }, userInput);
    for (const userInput of ["2.5", "2.0", ".5", "2^-1", "1.5 + 1", "2.5 + 0.5"])
      assert.deepEqual(problemWith(userInput), { kind: "fraction" }, userInput);
    for (const userInput of ["e100", "1e", "1e+", "2^", "^2", "1..5", "1e1e1", "2^2^3", "2^127-", "+", "-", "1 +", "2.5^2", "0^-1", "(2)", "2*3", "abc", "1e100x"])
      assert.deepEqual(problemWith(userInput), { kind: "not-a-number" }, userInput);
    for (const userInput of ["1,000e3", "2^1,000", "1,5e3", "1_000+1"]) assert.deepEqual(problemWith(userInput), { kind: "comma-in-expression" }, userInput);
    assert.deepEqual(problemWith("0^0"), { kind: "zero-to-the-zero" });
    assert.deepEqual(problemWith("00^000"), { kind: "zero-to-the-zero" });
  });

  it("works out 1 and 0 to any power without building anything", () => {
    const started = performance.now();
    assert.equal(valueOf("1^100000000000000000000"), 1n);
    assert.equal(valueOf("0^100000000000000000000"), 0n);
    assert.ok(performance.now() - started < 50);
  });

  it("refuses a number too long for any BigInt at once, with its digit count", () => {
    const started = performance.now();
    assert.deepEqual(problemWith("10^1000000000"), { kind: "too-many-digits", digits: 1_000_000_001n, about: false });
    assert.deepEqual(problemWith("1e99999999999999999999"), { kind: "too-many-digits", digits: 100_000_000_000_000_000_000n, about: false });
    assert.deepEqual(problemWith("2.5e400000000"), { kind: "too-many-digits", digits: 400_000_001n, about: false });
    assert.deepEqual(problemWith("2^2000000000"), { kind: "too-many-digits", digits: 602_059_992n, about: true });
    assert.equal(problemWith("2^1e3").kind, "not-a-number"); // an exponent is digits only
    // a later term too long, or an exponent past a double: still refused at once
    assert.equal(problemWith("1 + 10^1000000000").kind, "too-many-digits");
    assert.deepEqual(problemWith(`3^1${"0".repeat(400)}`), { kind: "too-many-digits" });
    assert.ok(performance.now() - started < 50);
  });

  it("builds a power right below the line it refuses at", () => {
    // 2^(2^30 − 2) has 2^30 − 1 bits: under the refusal bound, so it's built (V8 holds it)
    assert.equal(valueOf(`2^${LARGEST_BIGINT_BITS - 2n}`), 2n ** (LARGEST_BIGINT_BITS - 2n));
  });

  it("refuses a malformed expression as malformed, even after a term too long to build", () => {
    assert.equal(problemWith("10^1000000000 +").kind, "not-a-number");
  });
});

describe("shortestWriting", () => {
  it("keeps the expression only while it's shorter than the digits", () => {
    assert.equal(shortestWriting(10n ** 100n, "1e100"), "1e100");
    assert.equal(shortestWriting(2n ** 127n - 1n, "2^127-1"), "2^127-1");
    assert.equal(shortestWriting(1500n, "1.5e3"), "1500");
    assert.equal(shortestWriting(10000n, "1e4"), "1e4"); // 3 characters against 5 digits
    assert.equal(shortestWriting(100n, "1e2"), "100"); // as long: the digits
    assert.equal(shortestWriting(1_000_000n, null), "1000000");
  });
});
