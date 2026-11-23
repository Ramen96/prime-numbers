import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { isPrime } from "../tests/support/primality.ts";
import { certificatePathFor, LISTED_CERTIFICATES_DIRECTORY, listedAnswers, loadNodeEngine, settleListed } from "./listedAnswers.ts";
import { listedNumbers } from "./listedNumbers.ts";
import { answerHolds } from "./primeCheck.ts";
import { DETERMINISTIC_VERIFICATION_LIMIT } from "./primes/verifyPrimes.ts";

describe("the listed numbers' answers, settled at build time", () => {
  const answers = listedAnswers();

  it("settle every listed number, every answer holding and agreeing with the test reference", () => {
    assert.equal(answers.size, listedNumbers().length);
    for (const [value, answer] of answers) {
      assert.ok(answerHolds(answer), String(value));
      assert.notEqual(answer.kind, "probably-prime", "a listed page always shows a proof");
      if (value < 2n) assert.equal(answer.kind, "neither");
      else assert.equal(answer.kind === "prime", isPrime(value), String(value));
    }
  });

  it("prove listed primes from a(13) up by their committed certificates, and no file is left over", () => {
    const provenByCertificate = [...answers.values()].filter((answer) => answer.kind === "prime" && answer.proof.by === "certificate");
    assert.deepEqual(provenByCertificate.map(({ value }) => value >= DETERMINISTIC_VERIFICATION_LIMIT), provenByCertificate.map(() => true));
    assert.equal(provenByCertificate.length, 7);
    assert.deepEqual(
      readdirSync(LISTED_CERTIFICATES_DIRECTORY).sort(),
      provenByCertificate.map(({ value }) => path.basename(certificatePathFor(value))).sort(),
    );
  });

  it("give the evidence the page will show", () => {
    assert.deepEqual(answers.get(91n), { kind: "composite", value: 91n, evidence: { by: "factor", factor: 7n } });
    assert.equal(answers.get(2_027n)?.kind, "prime");
    // a Mersenne number always passes base 2 (2^p ≡ 1 mod 2^p − 1), so the witness is 3
    assert.deepEqual(answers.get(2n ** 67n - 1n), { kind: "composite", value: 2n ** 67n - 1n, evidence: { by: "witness", base: 3 } });
    assert.deepEqual(answers.get(DETERMINISTIC_VERIFICATION_LIMIT), {
      kind: "composite",
      value: DETERMINISTIC_VERIFICATION_LIMIT,
      evidence: { by: "lucas" },
    });
  });

  it("fail the build on a certificate that's missing or doesn't check", () => {
    const { numberCheck } = loadNodeEngine();
    const prime = 2n ** 127n - 1n;
    const directory = mkdtempSync(path.join(tmpdir(), "listed-certificates-"));
    assert.throws(() => settleListed(prime, numberCheck, directory), /no certificate: run npm run prove:listed/);

    copyFileSync(certificatePathFor(prime), certificatePathFor(prime, directory));
    assert.equal(settleListed(prime, numberCheck, directory).kind, "prime");
    const json = JSON.parse(readFileSync(certificatePathFor(prime, directory), "utf8"));
    json.steps[0].y = String(BigInt(json.steps[0].y) + 1n);
    writeFileSync(certificatePathFor(prime, directory), JSON.stringify(json));
    assert.throws(() => settleListed(prime, numberCheck, directory), /doesn’t prove it prime|doesn't prove it prime/);
  });
});
