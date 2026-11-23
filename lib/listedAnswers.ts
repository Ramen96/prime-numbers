// The answers for the listed numbers' pages (/is-prime/<n>), settled at build
// time in Node, the way the checker's worker settles any number: a factor below
// 65,536 in BigInt, otherwise wasm/number_check.c's verdict, and every answer
// re-checked by answerHolds. A listed prime from a(13) up is proven by its
// committed certificate (data/listed-certificates/, written by
// `npm run prove:listed`): the build never proves, it only checks, and it fails
// on a certificate that's missing or doesn't check. Server only (node:fs).

import { readFileSync } from "node:fs";
import path from "node:path";
import { certificateFromJson } from "./certificateExport.ts";
import { listedNumbers, LISTED_MAX_DIGITS } from "./listedNumbers.ts";
import { answerHolds, type PrimeCheckAnswer } from "./primeCheck.ts";
import { NumberCheck, settleNumber, type RawNumberCheckExports } from "./primes/numberCheck.ts";
import { ProofSlots, type RawProofSlotExports } from "./primes/proofSlots.ts";

/** Where the committed certificates are: one JSON file per listed prime from a(13) up, named by its digits. */
export const LISTED_CERTIFICATES_DIRECTORY = path.join(process.cwd(), "data", "listed-certificates");

export const certificatePathFor = (value: bigint, directory = LISTED_CERTIFICATES_DIRECTORY) =>
  path.join(directory, `${value}.json`);

/** The single-threaded build, loaded in Node: the same engine as the checker's worker. */
export function loadNodeEngine(): { numberCheck: NumberCheck; proofSlots: ProofSlots } {
  const bytes = readFileSync(path.join(process.cwd(), "public", "sieve.wasm"));
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: { emscripten_notify_memory_growth: () => {} },
  });
  (instance.exports._initialize as (() => void) | undefined)?.();
  return {
    numberCheck: new NumberCheck(instance.exports as unknown as RawNumberCheckExports),
    proofSlots: new ProofSlots(instance.exports as unknown as RawProofSlotExports),
  };
}

/**
 * The answer for one listed number, every one re-checked. Throws (failing the
 * build) if the engine's answer doesn't hold, or a probable prime's certificate
 * is missing or doesn't prove it.
 */
export function settleListed(value: bigint, numberCheck: NumberCheck, certificateDirectory = LISTED_CERTIFICATES_DIRECTORY): PrimeCheckAnswer {
  const settled = settleNumber(value, numberCheck);
  if (!settled.settled) throw new Error(`The listed number ${value} couldn't be settled (${settled.reason}).`);
  if (settled.answer.kind !== "probably-prime") return settled.answer;
  const file = certificatePathFor(value, certificateDirectory);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`The listed number ${value} is a probable prime with no certificate: run npm run prove:listed (${file}).`);
  }
  const { prime, steps } = certificateFromJson(text);
  const answer: PrimeCheckAnswer = { kind: "prime", value, proof: { by: "certificate", steps } };
  if (prime !== value || !answerHolds(answer)) throw new Error(`The certificate for the listed number ${value} doesn't prove it prime (${file}).`);
  return answer;
}

let answers: ReadonlyMap<bigint, PrimeCheckAnswer> | null = null;

/** Every listed number's answer, settled once per build process. */
export function listedAnswers(): ReadonlyMap<bigint, PrimeCheckAnswer> {
  if (answers) return answers;
  const { numberCheck } = loadNodeEngine();
  const settled = new Map<bigint, PrimeCheckAnswer>();
  for (const { value } of listedNumbers()) {
    if (value.toString().length > LISTED_MAX_DIGITS) throw new Error(`The listed number ${value} has more than ${LISTED_MAX_DIGITS} digits.`);
    settled.set(value, settleListed(value, numberCheck));
  }
  answers = settled;
  return answers;
}
