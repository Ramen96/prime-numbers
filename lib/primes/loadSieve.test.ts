import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sievingThreadsFor } from "./loadSieve.ts";

describe("sievingThreadsFor", () => {
  it("leaves the page one core", () => {
    assert.equal(sievingThreadsFor(10), 9);
    assert.equal(sievingThreadsFor(4), 3);
    assert.equal(sievingThreadsFor(2), 1);
  });

  it("is at least 1 (a single core, or a browser that doesn't say)", () => {
    assert.equal(sievingThreadsFor(1), 1);
    assert.equal(sievingThreadsFor(undefined), 1);
  });
});
