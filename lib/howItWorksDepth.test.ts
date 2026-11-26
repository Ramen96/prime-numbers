import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_DEPTH, depthAnnouncement, depthName, initialDepth, parseDepth, urlWithDepth } from "./howItWorksDepth.ts";

describe("parseDepth", () => {
  it("reads 1 to 4 and nothing else", () => {
    assert.deepEqual(["1", "2", "3", "4"].map(parseDepth), [1, 2, 3, 4]);
    for (const text of [null, undefined, "", "0", "5", "9", "2.5", " 2", "2 ", "02", "two", "-1"]) assert.equal(parseDepth(text), null, String(text));
  });
});

describe("initialDepth", () => {
  it("takes the link's level, else the saved one, else A bit deeper", () => {
    assert.equal(initialDepth("?level=4", "1"), 4);
    assert.equal(initialDepth("", "3"), 3);
    assert.equal(initialDepth("?level=9", "1"), 1); // a bad link falls back to the saved choice
    assert.equal(initialDepth("?level=9", "7"), DEFAULT_DEPTH);
    assert.equal(initialDepth("", null), 2);
    assert.equal(initialDepth("?jump=5&level=1", null), 1);
  });
});

describe("urlWithDepth", () => {
  it("sets ?level=, keeping the other parameters and the anchor", () => {
    assert.equal(urlWithDepth("https://example.com/how-it-works", 3), "/how-it-works?level=3");
    assert.equal(urlWithDepth("https://example.com/how-it-works?level=1#gpu-proofs", 4), "/how-it-works?level=4#gpu-proofs");
    assert.equal(urlWithDepth("https://example.com/how-it-works?x=1#big-mod-small", 2), "/how-it-works?x=1&level=2#big-mod-small");
  });
});

describe("the levels' names", () => {
  it("are the four the page uses, and the announcement names the chosen one", () => {
    assert.deepEqual([1, 2, 3, 4].map((level) => depthName(level as 1 | 2 | 3 | 4)), ["The basics", "A bit deeper", "Under the hood", "Turtles all the way down"]);
    assert.equal(depthAnnouncement(3), "Every section now opens to Under the hood.");
  });
});
