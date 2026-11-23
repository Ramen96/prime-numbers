import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LISTED_MAX_DIGITS, isPrimeHref, listedNeighbours, listedNumber, listedNumbers } from "./listedNumbers.ts";

describe("the listed numbers", () => {
  const all = listedNumbers();

  it("are 0 to 1,000, the years 1900 to 2100, and the notable ones, in order, once each", () => {
    for (let value = 0n; value <= 1_000n; value++) assert.ok(listedNumber(value), String(value));
    for (let year = 1_900n; year <= 2_100n; year++) assert.ok(listedNumber(year), String(year));
    assert.equal(listedNumber(1_001n), undefined);
    assert.equal(listedNumber(2_101n), undefined);
    for (let index = 1; index < all.length; index++) assert.ok(all[index - 1].value < all[index].value);
    // 1,001 + 201, and the notable numbers outside both ranges
    assert.equal(all.length, 1_001 + 201 + 24);
  });

  it("have at most 200 digits, so a built page's file name fits", () => {
    for (const { value } of all) assert.ok(value.toString().length <= LISTED_MAX_DIGITS, String(value));
  });

  it("know their neighbours, for the page's links", () => {
    assert.deepEqual(listedNeighbours(0n), { previous: null, next: 1n });
    assert.deepEqual(listedNeighbours(1_000n), { previous: 999n, next: 1_729n });
    assert.deepEqual(listedNeighbours(2n ** 607n - 1n), { previous: 2n ** 521n - 1n, next: null });
    assert.deepEqual(listedNeighbours(12_345n), { previous: null, next: null });
  });

  it("keep their notes as curly-quoted site copy", () => {
    const notes = all.flatMap(({ note }) => (note ? [note] : []));
    assert.ok(notes.length >= 25);
    for (const note of notes) assert.doesNotMatch(note, /['"]/, note);
  });
});

describe("isPrimeHref", () => {
  it("sends a listed number to its page and any other to the checker", () => {
    assert.equal(isPrimeHref(127n), "/is-prime/127");
    assert.equal(isPrimeHref(2n ** 127n - 1n), "/is-prime/170141183460469231731687303715884105727");
    assert.equal(isPrimeHref(8_191n), "/is-prime?n=8191");
  });
});
