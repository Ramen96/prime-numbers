import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sieveAnimation } from "./sieveAnimation.ts";

describe("sieveAnimation", () => {
  it("sieves 400–409 down to 401 and 409, crossing 404 out with 2", () => {
    const { cells, passes, survivors } = sieveAnimation(400, 409);
    assert.deepEqual(survivors, [401, 409]);
    assert.deepEqual(passes, [2, 3, 11, 13]);
    assert.deepEqual(
      cells.map((cell) => cell.crossedOutBy),
      [2, null, 2, 13, 2, 3, 2, 11, 2, null],
    );
    assert.deepEqual(cells.find((cell) => cell.value === 404), { value: 404, crossedOutBy: 2, pass: 0 });
  });

  it("crosses each number out with its smallest prime factor, in that prime's pass", () => {
    for (const cell of sieveAnimation(400, 409).cells) {
      if (cell.crossedOutBy === null) continue;
      assert.equal(cell.value % cell.crossedOutBy, 0);
      for (let smaller = 2; smaller < cell.crossedOutBy; smaller++) assert.notEqual(cell.value % smaller, 0);
    }
  });

  it("puts survivors in the pass after the last", () => {
    const { cells, passes } = sieveAnimation(400, 409);
    for (const cell of cells.filter((cell) => cell.crossedOutBy === null)) assert.equal(cell.pass, passes.length);
  });

  it("never crosses out a prime that is itself one of the sieving primes", () => {
    assert.deepEqual(sieveAnimation(2, 30).survivors, [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]);
  });
});
