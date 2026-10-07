import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jumpParameterFrom, urlForJump } from "./jumpUrl.ts";

describe("jumpParameterFrom", () => {
  it("reads ?jump=", () => {
    assert.equal(jumpParameterFrom("?jump=1000000000000"), "1000000000000");
    assert.equal(jumpParameterFrom("?jump=1,000,000"), "1,000,000");
  });

  it("is null when there's no jump parameter", () => {
    assert.equal(jumpParameterFrom(""), null);
    assert.equal(jumpParameterFrom("?other=1"), null);
  });
});

describe("urlForJump", () => {
  it("sets ?jump= to the target, keeping other parameters", () => {
    assert.equal(urlForJump("https://example.com/?ref=x", 1_000_000n), "/?ref=x&jump=1000000");
    assert.equal(urlForJump("https://example.com/?jump=5", 77n), "/?jump=77");
  });

  it("keeps every digit of numbers past 2^53", () => {
    assert.equal(urlForJump("https://example.com/", 18_446_744_073_709_551_557n), "/?jump=18446744073709551557");
  });

  it("clears ?jump= when jumping back to the start", () => {
    assert.equal(urlForJump("https://example.com/?jump=1000", 2n), "/");
    assert.equal(urlForJump("https://example.com/?jump=1000", 0n), "/");
  });
});
