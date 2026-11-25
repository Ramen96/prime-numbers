import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jumpParameterFrom, queryParameterFrom, urlForJump } from "./jumpUrl.ts";

describe("jumpParameterFrom", () => {
  it("reads ?jump=", () => {
    assert.equal(jumpParameterFrom("?jump=1000000000000"), "1000000000000");
    assert.equal(jumpParameterFrom("?jump=1,000,000"), "1,000,000");
  });

  it("is null when there's no jump parameter", () => {
    assert.equal(jumpParameterFrom(""), null);
    assert.equal(jumpParameterFrom("?other=1"), null);
  });

  it("keeps a typed plus as a plus, and decodes what this site writes", () => {
    assert.equal(jumpParameterFrom("?jump=10^100+7"), "10^100+7");
    assert.equal(jumpParameterFrom("?jump=10%5E100%2B7"), "10^100+7");
    assert.equal(jumpParameterFrom("?jump=1%20000"), "1 000");
    assert.equal(jumpParameterFrom("?x=1&jump=2%5E127-1&y=2"), "2^127-1");
    assert.equal(jumpParameterFrom("?jump=100%"), "100%");
    assert.equal(jumpParameterFrom("?jump"), "");
    assert.equal(queryParameterFrom("?n=1e30", "n"), "1e30");
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

  it("writes an expression when it's shorter than the digits", () => {
    assert.equal(urlForJump("https://example.com/", 10n ** 100n, "1e100"), "/?jump=1e100");
    assert.equal(urlForJump("https://example.com/", 10n ** 100n + 7n, "10^100+7"), "/?jump=10%5E100%2B7");
    assert.equal(urlForJump("https://example.com/", 1500n, "1.5e3"), "/?jump=1500");
  });

  it("clears ?jump= when jumping back to the start", () => {
    assert.equal(urlForJump("https://example.com/?jump=1000", 2n), "/");
    assert.equal(urlForJump("https://example.com/?jump=1000", 0n), "/");
  });
});
