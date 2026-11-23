import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LUCAS_LEHMER_DEMO_EXPONENTS, describeTerm, lucasLehmer, lucasLehmerConclusion } from "./lucasLehmerDemo.ts";

const isPrimeByTrialDivision = (value: bigint) => {
  if (value < 2n) return false;
  for (let divisor = 2n; divisor * divisor <= value; divisor++) if (value % divisor === 0n) return false;
  return true;
};

describe("lucasLehmer", () => {
  it("agrees with trial division for every exponent the demo offers", () => {
    const primes: number[] = [];
    for (const exponent of LUCAS_LEHMER_DEMO_EXPONENTS) {
      const run = lucasLehmer(exponent);
      assert.equal(run.mersenne, 2n ** BigInt(exponent) - 1n);
      assert.equal(run.prime, isPrimeByTrialDivision(run.mersenne), `2^${exponent} − 1`);
      assert.equal(run.terms.length, exponent - 1); // s₀ to s(p−2)
      for (const term of run.terms.slice(1)) assert.ok(term >= 0n && term < run.mersenne);
      if (run.prime) primes.push(exponent);
      else {
        assert.equal(run.factors.reduce((product, factor) => product * factor, 1n), run.mersenne);
        for (const factor of run.factors) {
          assert.ok(isPrimeByTrialDivision(factor));
          assert.equal((factor - 1n) % (2n * BigInt(exponent)), 0n); // every factor is 2kp + 1, as the page says
        }
      }
    }
    assert.deepEqual(primes, [3, 5, 7, 13, 17, 19, 31]);
  });

  it("gives the sequences the page quotes", () => {
    assert.deepEqual(lucasLehmer(7).terms, [4n, 14n, 67n, 42n, 111n, 0n]);
    assert.equal(lucasLehmer(11).terms.at(-1), 1_736n);
    assert.deepEqual(lucasLehmer(11).factors, [23n, 89n]);
    assert.deepEqual(lucasLehmer(23).factors, [47n, 178_481n]);
    assert.deepEqual(lucasLehmer(29).factors, [233n, 1_103n, 2_089n]);
  });

  it("refuses exponents it doesn't offer", () => {
    for (const exponent of [2, 4, 9, 37, 127]) assert.throws(() => lucasLehmer(exponent), RangeError);
  });
});

describe("the demo's words", () => {
  it("describes each term", () => {
    const run = lucasLehmer(7);
    assert.equal(describeTerm(run, 0), "s₀ = 4");
    assert.equal(describeTerm(run, 1), "s₁ = (4² − 2) mod 127 = 14");
    assert.equal(describeTerm(run, 5), "s₅ = (111² − 2) mod 127 = 0");
    assert.equal(describeTerm(lucasLehmer(31), 12).startsWith("s₁₂ = ("), true);
  });

  it("concludes as the page says", () => {
    assert.equal(lucasLehmerConclusion(lucasLehmer(7)), "After 5 steps the remainder is 0, so 2⁷ − 1 = 127 is prime.");
    assert.equal(
      lucasLehmerConclusion(lucasLehmer(11)),
      "After 9 steps the remainder is 1,736, not 0, so 2¹¹ − 1 = 2,047 isn’t prime. The test doesn’t say what its factors are: they’re 23 × 89.",
    );
    assert.equal(lucasLehmerConclusion(lucasLehmer(3)), "After 1 step the remainder is 0, so 2³ − 1 = 7 is prime.");
    assert.equal(lucasLehmerConclusion(lucasLehmer(31)), "After 29 steps the remainder is 0, so 2³¹ − 1 = 2,147,483,647 is prime.");
  });
});
