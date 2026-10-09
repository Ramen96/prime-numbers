import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CALCULATING_LINES, maybeMentatLine, MEMORY_LIMIT_LINES, MENTAT_CHANCE, type RandomSource } from "./mentatLines.ts";

/** A random source that returns `values` in turn. */
function sequence(...values: number[]): RandomSource {
  let call = 0;
  return () => values[call++];
}

describe("maybeMentatLine", () => {
  for (const [name, lines] of [
    ["calculating", CALCULATING_LINES],
    ["memory limit", MEMORY_LIMIT_LINES],
  ] as const) {
    it(`forced on, picks a line from the ${name} list, and each one can be picked`, () => {
      lines.forEach((line, index) => {
        assert.equal(maybeMentatLine(lines, sequence(0, (index + 0.5) / lines.length)), line);
      });
      assert.equal(maybeMentatLine(lines, sequence(0, 0.999_999)), lines.at(-1));
    });

    it(`forced off, picks nothing from the ${name} list`, () => {
      assert.equal(maybeMentatLine(lines, () => 0.999), null);
    });
  }

  it("has a 2 in 10 chance", () => {
    assert.equal(MENTAT_CHANCE, 0.2);
    assert.notEqual(maybeMentatLine(CALCULATING_LINES, sequence(0.199, 0)), null);
    assert.equal(maybeMentatLine(CALCULATING_LINES, sequence(0.2, 0)), null);
  });

  it("draws only once when it picks nothing", () => {
    let draws = 0;
    maybeMentatLine(CALCULATING_LINES, () => (draws++, 0.5));
    assert.equal(draws, 1);
  });

  it("has every line the easter egg asked for, and no others", () => {
    assert.equal(CALCULATING_LINES.length, 10);
    assert.equal(MEMORY_LIMIT_LINES.length, 5);
    assert.equal(new Set([...CALCULATING_LINES, ...MEMORY_LIMIT_LINES]).size, 15);
  });
});
