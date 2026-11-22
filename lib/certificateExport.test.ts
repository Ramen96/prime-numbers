import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certifiedPrimeFrom } from "../tests/support/curveCertificates.ts";
import {
  CERTIFICATE_FORMAT,
  certificateFileName,
  certificateFromJson,
  certificateJson,
  certificateText,
} from "./certificateExport.ts";
import { checkCertificate } from "./primes/primalityCertificate.ts";

const { prime, steps } = certifiedPrimeFrom(10n ** 40n);

describe("certificate downloads", () => {
  it("writes JSON that reads back to the same certificate, which still checks", () => {
    const text = certificateJson(prime, steps);
    const json = JSON.parse(text);
    assert.equal(json.format, CERTIFICATE_FORMAT);
    assert.equal(json.prime, prime.toString());
    assert.equal(json.steps.length, steps.length);
    assert.equal(typeof json.steps[0].N, "string", "numbers as decimal strings, exact at any size");
    const readBack = certificateFromJson(text);
    assert.equal(readBack.prime, prime);
    assert.deepEqual(readBack.steps, steps);
    assert.deepEqual(checkCertificate(readBack.prime, readBack.steps), { valid: true });
  });

  it("refuses JSON in any other format", () => {
    assert.throws(() => certificateFromJson(JSON.stringify({ format: "something else", prime: "7", steps: [] })));
  });

  it("writes text with the prime and every number of every step in full", () => {
    const text = certificateText(prime, steps);
    assert.ok(text.startsWith(`Elliptic curve primality certificate for the ${prime.toString().length}-digit number\n${prime}\n`));
    for (const [index, step] of steps.entries()) {
      assert.ok(text.includes(`Step ${index + 1} of ${steps.length}`));
      for (const [name, value] of [["N", step.number], ["a", step.curveA], ["b", step.curveB], ["x", step.pointX], ["y", step.pointY], ["q", step.orderPrime]] as const)
        assert.ok(text.includes(`${name} = ${value}\n`), `step ${index + 1} ${name}`);
    }
    assert.ok(text.includes("3317044064679887385961981"));
  });

  it("names the file after the prime's digits", () => {
    assert.equal(certificateFileName(prime, "json"), `prime-${prime.toString().length}-digits-certificate.json`);
    assert.equal(certificateFileName(prime, "txt"), `prime-${prime.toString().length}-digits-certificate.txt`);
  });
});
