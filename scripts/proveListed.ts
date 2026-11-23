// npm run prove:listed: writes a certificate for every listed probable prime
// (lib/listedNumbers.ts) that doesn't have one yet, to data/listed-certificates/,
// for the build to check (lib/listedAnswers.ts). Proves with the shipped
// single-threaded build, as the checker's worker does, and checks each
// certificate before writing it. --all proves them all again.

import { existsSync, writeFileSync } from "node:fs";
import { certificateJson } from "../lib/certificateExport.ts";
import { certificatePathFor, loadNodeEngine } from "../lib/listedAnswers.ts";
import { listedNumbers } from "../lib/listedNumbers.ts";
import { checkCertificate } from "../lib/primes/primalityCertificate.ts";
import { settleNumber } from "../lib/primes/numberCheck.ts";

const proveAll = process.argv.includes("--all");
const { numberCheck, proofSlots } = loadNodeEngine();

for (const { value } of listedNumbers()) {
  const settled = settleNumber(value, numberCheck);
  if (!settled.settled) throw new Error(`${value}: ${settled.reason}`);
  if (settled.answer.kind !== "probably-prime") continue;
  const file = certificatePathFor(value);
  if (existsSync(file) && !proveAll) continue;
  const started = performance.now();
  const { certificates, outOfMemory } = await proofSlots.proveInOrder([value]);
  if (outOfMemory) throw new Error(`${value}: memory ran out`);
  const steps = certificates[0];
  const check = checkCertificate(value, steps);
  if (!check.valid) throw new Error(`${value}: the new certificate doesn't check (${check.reason})`);
  writeFileSync(file, certificateJson(value, steps));
  const digits = value.toString().length;
  console.log(`${digits} digits, ${steps.length} steps, ${((performance.now() - started) / 1000).toFixed(1)} s: ${file}`);
}
