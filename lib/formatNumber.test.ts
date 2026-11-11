import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatWholeNumber } from "./formatNumber.ts";

const intl = new Intl.NumberFormat("en-US");

describe("formatWholeNumber", () => {
  it("writes exactly what Intl.NumberFormat writes, wherever Intl can", () => {
    for (let value = -1500n; value <= 12_000n; value++) assert.equal(formatWholeNumber(value), intl.format(value));
    for (let digits = 1; digits <= 3000; digits += 7) {
      const value = 10n ** BigInt(digits - 1) + BigInt(digits) * 7919n;
      assert.equal(formatWholeNumber(value), intl.format(value), `${digits} digits`);
      assert.equal(formatWholeNumber(-value), intl.format(-value), `−, ${digits} digits`);
    }
  });

  it("goes on past where Intl.NumberFormat throws: a million digits and more", () => {
    for (const digits of [1_000_000, 1_000_001, 2_000_002]) {
      const value = 10n ** BigInt(digits - 1) + 13n;
      const formatted = formatWholeNumber(value);
      assert.equal(formatted.replaceAll(",", ""), value.toString(), `${digits} digits, every digit kept`);
      const groups = formatted.split(",");
      assert.ok(groups.slice(1).every((group) => group.length === 3), "groups of three after the first");
      assert.ok(groups[0].length >= 1 && groups[0].length <= 3);
    }
  });
});
