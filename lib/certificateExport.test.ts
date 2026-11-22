import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certifiedPrimeFrom } from "../tests/support/curveCertificates.ts";
import {
  CERTIFICATE_FORMAT,
  certificateFileName,
  certificateFromJson,
  certificateJson,
  certificateText,
  readCertificate,
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

describe("readCertificate (the check-a-certificate box)", () => {
  const unreadable = (text: string) => {
    const read = readCertificate(text);
    assert.equal(read.readable, false, text.slice(0, 80));
    return read.readable ? "" : read.reason;
  };

  it("reads both download formats back to the same certificate", () => {
    for (const text of [certificateJson(prime, steps), certificateText(prime, steps)]) {
      const read = readCertificate(text);
      assert.ok(read.readable);
      assert.equal(read.prime, prime);
      assert.deepEqual(read.steps, steps);
      assert.deepEqual(checkCertificate(read.prime, read.steps), { valid: true });
    }
  });

  it("reads numbers grouped with commas, spaces or underscores, as the page shows them", () => {
    const grouped = certificateText(prime, steps).replace(/\d+/g, (digits) =>
      digits.length < 4 ? digits : BigInt(digits).toLocaleString("en-US"),
    );
    const read = readCertificate(grouped);
    assert.ok(read.readable);
    assert.deepEqual(read.steps, steps);
    const spaced = readCertificate(certificateText(prime, steps).replace(`N = ${steps[0].number}`, `N = ${steps[0].number.toString().replace(/(\d{3})/g, "$1 ")}`));
    assert.ok(spaced.readable);
    assert.equal(spaced.steps[0].number, steps[0].number);
  });

  it("reads a text certificate that's been trimmed to just the prime and the steps", () => {
    const bare = [String(prime), ...steps.flatMap((step) => [`N = ${step.number}`, `a = ${step.curveA}`, `b = ${step.curveB}`, `x = ${step.pointX}`, `y = ${step.pointY}`, `q = ${step.orderPrime}`])].join("\n");
    const read = readCertificate(bare);
    assert.ok(read.readable);
    assert.deepEqual(read.steps, steps);
  });

  it("says why it can't read anything else", () => {
    assert.equal(unreadable("   \n "), "it’s empty");
    assert.equal(unreadable("hello there"), "it’s in neither of this page’s formats (JSON or text)");
    assert.equal(unreadable("{ not json"), "it starts like JSON but doesn’t parse as JSON");
    assert.match(unreadable(JSON.stringify({ format: "something else" })), /^it’s JSON, but not in this site’s format/);

    const json = JSON.parse(certificateJson(prime, steps));
    assert.equal(unreadable(JSON.stringify({ ...json, prime: undefined })), "the prime is missing");
    assert.equal(unreadable(JSON.stringify({ ...json, prime: "12a" })), "the prime isn’t a whole number");
    assert.equal(unreadable(JSON.stringify({ ...json, prime: 1234 })), "the prime isn’t a whole number");
    assert.equal(unreadable(JSON.stringify({ ...json, steps: [] })), "it has no steps");
    assert.equal(unreadable(JSON.stringify({ ...json, steps: undefined })), "it has no steps");
    const [first, second, ...rest] = json.steps;
    assert.equal(unreadable(JSON.stringify({ ...json, steps: [first, { ...second, y: undefined }, ...rest] })), "step 2 has no y");
    assert.equal(unreadable(JSON.stringify({ ...json, steps: [first, { ...second, x: "-5" }, ...rest] })), "step 2’s x isn’t a whole number");

    const text = certificateText(prime, steps);
    assert.equal(unreadable(text.replace(/^q = .*$/m, "")), "step 1 has no q");
    assert.equal(unreadable(text.replace(/^a = .*$/m, "a = twelve")), "step 1’s a isn’t a whole number");
    assert.equal(unreadable(`${prime}\nq = 5\nN = 7`), "“q =” comes before the first step’s N");
    assert.equal(unreadable(`N = ${steps[0].number}`), "the prime is missing");
  });

  it("only reads: a certificate that doesn't hold still reads, and the checker says which step fails", () => {
    const tampered = certificateText(prime, steps).replace(`y = ${steps[1].pointY}`, `y = ${steps[1].pointY + 1n}`);
    const read = readCertificate(tampered);
    assert.ok(read.readable);
    const check = checkCertificate(read.prime, read.steps);
    assert.equal(check.valid, false);
    if (!check.valid) assert.equal(check.number, steps[1].number);
  });
});
