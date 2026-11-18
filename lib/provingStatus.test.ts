import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeProving } from "./provingStatus.ts";

describe("describeProving", () => {
  it("says only that it's proving at first", () => {
    assert.equal(describeProving({ elapsedMs: 0, digits: null, reachedDigits: null }), "proving primality…");
    assert.equal(describeProving({ elapsedMs: 900, digits: 100, reachedDigits: 100 }), "proving primality…");
  });

  it("adds how long it's taken from a second in", () => {
    assert.equal(describeProving({ elapsedMs: 12_400, digits: 100, reachedDigits: 100 }), "proving primality… 12 s");
    assert.equal(describeProving({ elapsedMs: 210_000, digits: 300, reachedDigits: 300 }), "proving primality… 3.5 min");
  });

  it("adds how far the chain has got once it has gone down", () => {
    assert.equal(
      describeProving({ elapsedMs: 12_000, digits: 100, reachedDigits: 63 }),
      "proving primality… 12 s, down to 63 of 100 digits",
    );
    assert.equal(
      describeProving({ elapsedMs: 500, digits: 12_000, reachedDigits: 1_204 }),
      "proving primality… down to 1,204 of 12,000 digits",
    );
  });
});
