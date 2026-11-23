// The prime checker's engine (/is-prime), as its worker sees it: one number's
// verdict from wasm/number_check.c, read across the Wasm boundary as limbs, and
// settled only once the evidence holds in BigInt (lib/primeCheck.ts). Nothing
// the C side says is shown unchecked (Requirement A3).

import { answerFromVerdict, answerHolds, smallestSmallFactor, type PrimeCheckAnswer } from "../primeCheck.ts";
import { toLimbs, unsigned32 } from "./wasmSieve.ts";

/** The checker's functions, as the standalone build exports them. */
export interface RawNumberCheckExports {
  memory: WebAssembly.Memory;
  number_check_input_buffer(limbCount: number): number;
  check_number(limbCount: number): number;
  number_check_evidence(): number;
}

export class NumberCheck {
  readonly #raw: RawNumberCheckExports;

  constructor(raw: RawNumberCheckExports) {
    this.#raw = raw;
  }

  /** check_number's verdict and evidence for `value`; the out-of-memory verdict if its limbs don't fit. */
  verdictFor(value: bigint): { verdict: number; evidence: number } {
    const limbs = toLimbs(value);
    const pointer = unsigned32(this.#raw.number_check_input_buffer(limbs.length));
    if (pointer === 0) return { verdict: OUT_OF_MEMORY_VERDICT, evidence: 0 };
    // a fresh view after the call: memory growth detaches old ones
    new Uint32Array(this.#raw.memory.buffer, pointer, limbs.length).set(limbs);
    const verdict = this.#raw.check_number(limbs.length);
    return { verdict, evidence: unsigned32(this.#raw.number_check_evidence()) };
  }
}

/** primality_verdict's PRIMALITY_OUT_OF_MEMORY. */
const OUT_OF_MEMORY_VERDICT = 5;

export type SettledNumber =
  | { settled: true; answer: PrimeCheckAnswer }
  /** Memory ran out: nothing is known, and nothing is shown. */
  | { settled: false; reason: "out-of-memory" }
  /**
   * The engine's answer didn't hold when checked again, or it gave a verdict it
   * never should: stop and say so, never show it. `answer` is what it claimed, if anything.
   */
  | { settled: false; reason: "disputed"; answer: PrimeCheckAnswer | null; verdict: number };

/**
 * Settles `value` as far as it can without a proof: a factor below 65,536 if
 * there is one (found here, in BigInt), otherwise the C engine's verdict.
 * Either way the answer is re-checked by answerHolds before it's returned.
 * From a(13) up a BPSW pass comes back as "probably-prime", for the page to prove.
 */
export function settleNumber(value: bigint, engine: NumberCheck): SettledNumber {
  const factor = smallestSmallFactor(value);
  let answer: PrimeCheckAnswer;
  let verdict = -1;
  if (factor !== null) {
    answer = { kind: "composite", value, evidence: { by: "factor", factor } };
  } else {
    const fromEngine = engine.verdictFor(value);
    verdict = fromEngine.verdict;
    const read = answerFromVerdict(value, fromEngine.verdict, fromEngine.evidence);
    if (!read.settled)
      return read.reason === "out-of-memory" ? { settled: false, reason: "out-of-memory" } : { settled: false, reason: "disputed", answer: null, verdict };
    answer = read.answer;
  }
  return answerHolds(answer) ? { settled: true, answer } : { settled: false, reason: "disputed", answer, verdict };
}
