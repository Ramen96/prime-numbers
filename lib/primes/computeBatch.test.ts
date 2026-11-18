import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certifiedPrimeFrom } from "../../tests/support/curveCertificates.ts";
import {
  computeBatch,
  digitsOfBitLength,
  PROGRESS_INTERVAL_MS,
  STREAM_INTERVAL_MS,
  type ComputeBatchOptions,
  type Sieve,
} from "./computeBatch.ts";
import type { CertificateStep } from "./primalityCertificate.ts";
import type { ProveOptions, ProvenInOrder } from "./proofSlots.ts";
import { ProvenPrimeCache } from "./provenPrimeCache.ts";
import { PARTIAL_SIEVE_PRIME_CAP } from "./sieveCalibrator.ts";
import { fewestBasePrimeBytes } from "./memoryBudget.ts";
import type { BatchRequest, WorkerResponse } from "./protocol.ts";
import { basePrimeLimitNeededFor, NO_SIEVE_PRIME_CAP, type RejectedComposite } from "./wasmSieve.ts";

const REQUEST: BatchRequest = { type: "batch", id: 1, generation: 1, direction: "next", from: 1n, count: 5 };

type StandInSieve = Sieve & { reservations: number[]; caps: bigint[] };

/** A stand-in sieve that returns whatever it's told to, right or wrong. */
function standInSieve(
  primes: bigint[],
  options: {
    basePrimeLimit?: bigint;
    extends?: boolean;
    measuringMs?: number;
    rejected?: RejectedComposite[];
    reachedMemoryLimit?: boolean;
    reachedProvenBound?: boolean;
  } = {},
): StandInSieve {
  const reservations: number[] = [];
  const caps: bigint[] = [];
  return {
    reservations,
    caps,
    basePrimeLimit: () => options.basePrimeLimit ?? 10n ** 12n,
    extendBasePrimes: () => options.extends ?? true,
    reserveBasePrimeStorage: (bytes) => (reservations.push(bytes), true),
    basePrimeMemoryBytes: () => 1234,
    moduleMemoryBytes: () => 5678,
    setSievePrimeCap: (cap) => void caps.push(cap),
    findPrimes: () => ({
      primes,
      rejected: options.rejected ?? [],
      reachedMemoryLimit: options.reachedMemoryLimit ?? false,
      reachedProvenBound: options.reachedProvenBound ?? false,
      measuringMs: options.measuringMs ?? 0,
    }),
  };
}

async function run(
  sieve: Sieve,
  request = REQUEST,
  memoryBudgetBytes: number | null = null,
  options: Omit<ComputeBatchOptions, "memoryBudgetBytes"> = {},
): Promise<WorkerResponse[]> {
  const sent: WorkerResponse[] = [];
  await computeBatch(sieve, request, (response) => sent.push(response), { memoryBudgetBytes, ...options });
  return sent;
}

describe("computeBatch", () => {
  it("sends verified primes with separate sieving, setup and verification times", async () => {
    const [response] = await run(standInSieve([2n, 3n, 5n, 7n, 11n]));
    assert.equal(response.type, "batch");
    if (response.type !== "batch") return;
    assert.deepEqual(response.primes, [2n, 3n, 5n, 7n, 11n]);
    assert.equal(typeof response.verificationDurationMs, "number");
    assert.deepEqual(response.memory, { basePrimeBytes: 1234, moduleBytes: 5678 });
    assert.equal(response.threads, 1);
  });

  it("counts time spent measuring thread splits as setup, not sieving", async () => {
    let clock = 0;
    const sieve = standInSieve([2n, 3n, 5n], { measuringMs: 30 });
    sieve.findPrimes = (...args) => {
      clock += 40; // 30 ms measuring, 10 ms sieving
      return standInSieve([2n, 3n, 5n], { measuringMs: 30 }).findPrimes(...args);
    };
    const sent: WorkerResponse[] = [];
    await computeBatch(sieve, REQUEST, (response) => sent.push(response), { memoryBudgetBytes: null, now: () => clock });
    const [response] = sent;
    assert.equal(response.type, "batch");
    if (response.type !== "batch") return;
    assert.equal(response.sievingDurationMs, 10);
    assert.equal(response.setupDurationMs, 30);
  });

  it("verifies through the injected verifier (the worker pool), and reports the threads", async () => {
    const checked: bigint[][] = [];
    const [response] = await run(standInSieve([2n, 3n, 5n]), REQUEST, null, {
      threads: 9,
      verify: async (primes) => (checked.push(primes), { verified: true }),
    });
    assert.deepEqual(checked, [[2n, 3n, 5n]]);
    assert.equal(response.type === "batch" && response.threads, 9);
  });

  it("never sends a batch an asynchronous verifier disputes", async () => {
    const sent = await run(standInSieve([2n, 3n, 5n]), REQUEST, null, {
      verify: async () => ({ verified: false, disputedPrime: 5n, verdict: "composite" }),
    });
    assert.deepEqual(sent.map((response) => response.type), ["error"]);
  });

  it("never sends a batch the verification disagrees with", async () => {
    const sent = await run(standInSieve([2n, 3n, 5n, 7n, 9n]));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, "error");
    if (sent[0].type === "error") assert.match(sent[0].message, /reported 9 as prime/);
  });

  it("passes the verifier an empty Map of certificates when nothing past a(13) was proven", async () => {
    const passed: unknown[] = [];
    await run(standInSieve([2n, 3n, 5n]), REQUEST, null, {
      verify: async (_primes, _rejected, certificates) => (passed.push(certificates), { verified: true }),
    });
    assert.deepEqual(passed, [new Map()]);
  });

  it("refuses a prime past a(13) that has no certificate, and says so", async () => {
    const sent = await run(standInSieve([10n ** 30n + 57n]), { ...REQUEST, from: 10n ** 30n, count: 1 });
    assert.deepEqual(sent.map((response) => response.type), ["error"]);
    if (sent[0].type === "error") {
      assert.match(sent[0].message, /reported 1000000000000000000000000000057 as prime, .*no certificate/);
    }
  });

  it("names a prime whose certificate doesn't hold, with the checker's reason", async () => {
    const sent = await run(standInSieve([10n ** 30n + 57n]), { ...REQUEST, from: 10n ** 30n, count: 1 }, null, {
      verify: async () => ({
        verified: false,
        disputedPrime: 10n ** 30n + 57n,
        verdict: "certificate-invalid",
        reason: "the chain is broken",
      }),
    });
    assert.deepEqual(sent.map((response) => response.type), ["error"]);
    if (sent[0].type === "error") {
      assert.match(sent[0].message, /certificate for 1000000000000000000000000000057 doesn’t prove it prime/);
      assert.match(sent[0].message, /\(the chain is broken\)/);
    }
  });

  it("sieves fully, with no cap, when every base prime a batch needs fits", async () => {
    const sieve = standInSieve([2n, 3n, 5n]);
    await run(sieve);
    assert.deepEqual(sieve.caps, [NO_SIEVE_PRIME_CAP]);
  });

  it("announces base-prime building, and if it runs out of memory, sieves partially instead", async () => {
    const sieve = standInSieve([9223372036854775837n], { basePrimeLimit: 0n, extends: false });
    const sent = await run(sieve, { ...REQUEST, from: 2n ** 63n, count: 1 });
    assert.deepEqual(sent.map((response) => response.type), ["building-base-primes", "batch"]);
    assert.deepEqual(sieve.caps, [PARTIAL_SIEVE_PRIME_CAP]);
  });

  it("sieves partially at once when base primes can't possibly fit: nothing built, nothing reserved", async () => {
    const sieve = standInSieve([10n ** 30n + 57n]);
    // past a(13) nothing could be verified; this test is about building and reserving
    const sent = await run(sieve, { ...REQUEST, from: 10n ** 30n, count: 1 }, null, {
      verify: async () => ({ verified: true }),
    });
    assert.deepEqual(sent.map((response) => response.type), ["batch"]);
    assert.deepEqual(sieve.caps, [PARTIAL_SIEVE_PRIME_CAP]);
    assert.deepEqual(sieve.reservations, []);
  });

  it("checks against the device's budget, not just the module's address space", async () => {
    // near 10^21 the base primes take about 1.4 GB
    const request = { ...REQUEST, from: 10n ** 21n, count: 1 };
    const prime = [10n ** 21n + 117n];
    const withRoom = standInSieve(prime, { basePrimeLimit: 0n });
    assert.deepEqual((await run(withRoom, request, 2 * 2 ** 30)).map((response) => response.type), [
      "building-base-primes",
      "batch",
    ]);
    assert.deepEqual(withRoom.caps, [NO_SIEVE_PRIME_CAP]);
    const withoutRoom = standInSieve(prime, { basePrimeLimit: 0n });
    assert.deepEqual((await run(withoutRoom, request, 2 ** 30)).map((response) => response.type), ["batch"]);
    assert.deepEqual(withoutRoom.caps, [PARTIAL_SIEVE_PRIME_CAP]);
  });

  it("passes the rejected composites to the verifier with the primes", async () => {
    const rejected: RejectedComposite[] = [{ candidate: 2047n, evidence: 3, kind: "evidence" }];
    const checked: unknown[] = [];
    await run(standInSieve([2053n], { rejected }), REQUEST, null, {
      verify: async (primes, rejectedComposites) => (checked.push([primes, rejectedComposites]), { verified: true }),
    });
    assert.deepEqual(checked, [[[2053n], rejected]]);
  });

  it("never sends a batch with a rejected composite whose evidence doesn't hold", async () => {
    const sent = await run(standInSieve([2053n], { rejected: [{ candidate: 2039n, evidence: 3, kind: "evidence" }] })); // 2039 is prime
    assert.deepEqual(sent.map((response) => response.type), ["error"]);
    if (sent[0].type === "error") assert.match(sent[0].message, /rejected 2039 as composite/);
  });

  it("stops with an error if the sieve ever stops at a(13) instead of passing primes on to be proven", async () => {
    for (const primes of [[], [2n, 3n]]) {
      const sent = await run(standInSieve(primes, { reachedProvenBound: true }));
      assert.deepEqual(sent.map((response) => response.type), ["error"]);
      if (sent[0].type === "error") assert.match(sent[0].message, /stopped at 3\.3 × 10²⁴/);
    }
  });

  it("reports the memory limit only when the sieve ran out with no prime proven", async () => {
    const sent = await run(standInSieve([], { reachedMemoryLimit: true }));
    assert.deepEqual(sent.map((response) => response.type), ["memory-limit"]);
  });

  it("uses the measured cap past the switch point: nothing built, measuring counted as setup", async () => {
    const sieve = standInSieve([9223372036854775837n], { basePrimeLimit: 0n });
    const [response, ...rest] = await run(sieve, { ...REQUEST, from: 2n ** 63n, count: 1 }, null, {
      calibrator: { capFor: () => ({ agreed: true, cap: 2n ** 18n, setupMs: 25 }) },
    });
    assert.deepEqual(rest, []);
    assert.equal(response.type, "batch");
    if (response.type === "batch") assert.equal(response.setupDurationMs, 25);
    assert.deepEqual(sieve.caps, [2n ** 18n]);
    assert.deepEqual(sieve.reservations, []);
  });

  it("builds and sieves fully below the switch point, adding building to the measuring", async () => {
    let clock = 0;
    const sieve = standInSieve([9007199254741033n], { basePrimeLimit: 0n });
    sieve.extendBasePrimes = () => ((clock += 7), true);
    const sent: WorkerResponse[] = [];
    await computeBatch(sieve, { ...REQUEST, from: 2n ** 53n, count: 1 }, (response) => sent.push(response), {
      memoryBudgetBytes: null,
      now: () => clock,
      calibrator: { capFor: () => ({ agreed: true, cap: null, setupMs: 25 }) },
    });
    assert.deepEqual(sent.map((response) => response.type), ["building-base-primes", "batch"]);
    assert.deepEqual(sieve.caps, [NO_SIEVE_PRIME_CAP]);
    if (sent[1].type === "batch") assert.equal(sent[1].setupDurationMs, 32);
  });

  it("stops with an error when the two methods disagree, sending no primes", async () => {
    const sent = await run(standInSieve([2n]), REQUEST, null, {
      calibrator: { capFor: () => ({ agreed: false, from: 2n ** 40n }) },
    });
    assert.deepEqual(sent.map((response) => response.type), ["error"]);
    if (sent[0].type === "error") assert.match(sent[0].message, /different answers near 1099511627776/);
  });

  it("reserves base-prime storage from an estimate before building, within the budget", async () => {
    const sieve = standInSieve([9007199254741033n], { basePrimeLimit: 0n });
    await run(sieve, { ...REQUEST, from: 2n ** 53n, count: 1 });
    // √(2^53) ≈ 9.5 × 10^7: about 5.5 million base primes
    assert.equal(sieve.reservations.length, 1);
    assert.ok(sieve.reservations[0] > 5_400_000 && sieve.reservations[0] < 5_700_000);

    // a budget between the proven minimum and the estimate: reserve only the budget
    const budget = fewestBasePrimeBytes(basePrimeLimitNeededFor("next", 2n ** 53n, 1));
    assert.ok(budget < sieve.reservations[0]);
    const capped = standInSieve([9007199254741033n], { basePrimeLimit: 0n });
    await run(capped, { ...REQUEST, from: 2n ** 53n, count: 1 }, budget);
    assert.deepEqual(capped.reservations, [budget]);
  });

  it("doesn't reserve when the base primes are already there", async () => {
    const sieve = standInSieve([2n, 3n, 5n, 7n, 11n]);
    await run(sieve);
    assert.deepEqual(sieve.reservations, []);
  });
});

describe("computeBatch past a(13): proving before verifying (Phase 5)", () => {
  // primes past a(13) with real certificates, ascending, and one below it
  const CERTIFIED = [10n ** 25n, 10n ** 26n, 10n ** 27n].map(certifiedPrimeFrom);
  const [FIRST, SECOND, THIRD] = CERTIFIED.map(({ prime }) => prime);
  const BELOW_BOUND = 1_000_003n;
  const BATCH = [BELOW_BOUND, FIRST, SECOND, THIRD];
  const CERTIFICATE_OF = new Map(CERTIFIED.map(({ prime, steps }) => [prime, steps]));

  /** A stand-in for ProofSlots: the real certificates, for the first `provable` candidates. */
  function standInProver(asked: bigint[][], provable = Infinity) {
    return async (candidates: bigint[], options: Pick<ProveOptions, "onProven"> = {}): Promise<ProvenInOrder> => {
      asked.push(candidates);
      const certificates = candidates.slice(0, provable).map((candidate) => CERTIFICATE_OF.get(candidate)!);
      certificates.forEach((certificate, index) => options.onProven?.(index, certificate));
      return { certificates, outOfMemory: provable < candidates.length, stopped: false };
    };
  }

  it("proves only the primes past a(13), upward, and checks their certificates before sending", async () => {
    const asked: bigint[][] = [];
    const verified: { primes: bigint[]; certificates: Map<bigint, readonly CertificateStep[]> }[] = [];
    const [proving, response] = await run(standInSieve(BATCH), REQUEST, null, {
      prove: standInProver(asked),
      verify: (primes, rejected, certificates) => (verified.push({ primes, certificates: new Map(certificates) }), {
        verified: true,
      }),
    });
    assert.equal(proving.type, "proving");
    assert.deepEqual(asked, [[FIRST, SECOND, THIRD]]);
    // first the prime below a(13) (and any rejections), then the certificates
    assert.deepEqual(verified, [
      { primes: [BELOW_BOUND], certificates: new Map() },
      { primes: [FIRST, SECOND, THIRD], certificates: CERTIFICATE_OF },
    ]);
    assert.equal(response.type === "batch" && response.primes.length, 4);
  });

  it("sends a batch the real verifier accepts with the prover's certificates", async () => {
    const [proving, response] = await run(standInSieve(BATCH), REQUEST, null, { prove: standInProver([]) });
    assert.equal(proving.type, "proving");
    assert.equal(response.type, "batch");
    if (response.type === "batch") assert.deepEqual(response.primes, BATCH);
  });

  it("proves downward for a batch going back", async () => {
    const asked: bigint[][] = [];
    await run(standInSieve(BATCH), { ...REQUEST, direction: "prev", from: THIRD + 1n }, null, {
      prove: standInProver(asked),
    });
    assert.deepEqual(asked, [[THIRD, SECOND, FIRST]]);
  });

  it("asks for no proofs when every prime is below a(13)", async () => {
    const asked: bigint[][] = [];
    await run(standInSieve([2n, 3n, 5n]), REQUEST, null, { prove: standInProver(asked) });
    assert.deepEqual(asked, []);
  });

  it("if memory runs out going up, sends the primes before the unproven one, flagged", async () => {
    const [proving, response] = await run(standInSieve(BATCH), REQUEST, null, { prove: standInProver([], 1) });
    assert.equal(proving.type, "proving");
    assert.equal(response.type, "batch");
    if (response.type !== "batch") return;
    assert.deepEqual(response.primes, [BELOW_BOUND, FIRST]);
    assert.equal(response.reachedMemoryLimit, true);
  });

  it("if memory runs out going back, sends the primes after the unproven one", async () => {
    const [proving, response] = await run(standInSieve(BATCH), { ...REQUEST, direction: "prev", from: THIRD + 1n }, null, {
      prove: standInProver([], 1),
    });
    assert.equal(proving.type, "proving");
    assert.equal(response.type, "batch");
    if (response.type === "batch") assert.deepEqual(response.primes, [THIRD]);
  });

  it("reports the memory limit when not even the first could be proven", async () => {
    const sent = await run(standInSieve([FIRST, SECOND]), REQUEST, null, { prove: standInProver([], 0) });
    assert.deepEqual(sent.map((response) => response.type), ["proving", "memory-limit"]);
  });

  it("counts proving as sieving time, and checking the certificates as verification", async () => {
    let clock = 0;
    const sieve = standInSieve(BATCH);
    const [proving, response] = await run(sieve, REQUEST, null, {
      now: () => clock,
      prove: async (candidates) => {
        clock += 70;
        return standInProver([])(candidates);
      },
      verify: () => ((clock += 5), { verified: true }),
    });
    assert.equal(proving.type, "proving");
    assert.equal(response.type, "batch");
    if (response.type !== "batch") return;
    assert.equal(response.sievingDurationMs, 70);
    assert.equal(response.verificationDurationMs, 5);
  });

  it("says it's proving before it proves, so Stop can pause it", async () => {
    const sent = await run(standInSieve(BATCH), REQUEST, null, { prove: standInProver([]) });
    assert.deepEqual(sent.map((response) => response.type), ["proving", "batch"]);
  });

  it("answers a stop during proving with a pause, sending nothing from the batch", async () => {
    const verified: bigint[][] = [];
    let stopRequested = false;
    const sent = await run(standInSieve(BATCH), REQUEST, null, {
      prove: async (_candidates, { shouldStop }) => {
        stopRequested = true; // the page pauses while it's proving
        assert.equal(shouldStop?.(), true, "the prover is given the stop check");
        return { certificates: [], outOfMemory: false, stopped: true };
      },
      shouldStop: () => stopRequested,
      verify: (primes) => (verified.push(primes), { verified: true }),
    });
    assert.deepEqual(sent.map((response) => response.type), ["proving", "paused"]);
    assert.deepEqual(verified, [[BELOW_BOUND]], "only the up-front check: nothing past a(13), nothing sent");
  });

  it("doesn't prove or check again a prime it already proved, and still sends it", async () => {
    const cache = new ProvenPrimeCache();
    await run(standInSieve(BATCH), REQUEST, null, { prove: standInProver([]), provenPrimes: cache });
    const asked: bigint[][] = [];
    const checked: bigint[][] = [];
    const [response] = await run(standInSieve(BATCH), REQUEST, null, {
      prove: standInProver(asked),
      provenPrimes: cache,
      verify: (primes) => (checked.push(primes), { verified: true }),
    });
    assert.deepEqual(asked, [], "nothing proven again, so no proving notice either");
    assert.deepEqual(checked, [[BELOW_BOUND]], "only the prime below a(13) is checked again");
    assert.equal(response.type, "batch");
    if (response.type === "batch") assert.deepEqual(response.primes, BATCH);
  });

  it("keeps only primes past a(13) that passed the check and were sent", async () => {
    const cache = new ProvenPrimeCache();
    await run(standInSieve(BATCH), REQUEST, null, {
      prove: standInProver([]),
      provenPrimes: cache,
      verify: () => ({ verified: false, disputedPrime: FIRST, verdict: "certificate-invalid", reason: "test" }),
    });
    assert.equal(cache.size, 0, "a batch the check disputed adds nothing");

    await run(standInSieve(BATCH), REQUEST, null, { prove: standInProver([], 1), provenPrimes: cache });
    assert.deepEqual([FIRST, SECOND, THIRD].map((prime) => cache.has(prime)), [true, false, false], "only what was sent");
    assert.equal(cache.has(BELOW_BOUND), false, "below a(13), recomputing is cheap");
  });

  it("does nothing at all for a request stopped before it began", async () => {
    let sieved = false;
    const sieve = standInSieve(BATCH);
    const findPrimes = sieve.findPrimes;
    sieve.findPrimes = (...args) => ((sieved = true), findPrimes(...args));
    const sent = await run(sieve, REQUEST, null, { prove: standInProver([]), shouldStop: () => true });
    assert.deepEqual(sent, []);
    assert.equal(sieved, false);
  });
});

describe("computeBatch streaming primes past a(13) as they're proven (step 5c)", () => {
  const CERTIFIED = [10n ** 25n, 10n ** 26n, 10n ** 27n].map(certifiedPrimeFrom);
  const [FIRST, SECOND, THIRD] = CERTIFIED.map(({ prime }) => prime);
  const BELOW_BOUND = 1_000_003n;
  const BATCH = [BELOW_BOUND, FIRST, SECOND, THIRD];
  const CERTIFICATE_OF = new Map(CERTIFIED.map(({ prime, steps }) => [prime, steps]));
  const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  /** Proves each candidate in `msPerPrime` of the fake clock, reporting it and letting checks run in between. */
  function slowProver(clock: { now: number }, msPerPrime: number, certificateFor = (prime: bigint) => CERTIFICATE_OF.get(prime)!) {
    return async (candidates: bigint[], options: Pick<ProveOptions, "onProven" | "shouldStop"> = {}) => {
      const certificates = [];
      for (const [index, candidate] of candidates.entries()) {
        clock.now += msPerPrime;
        const certificate = certificateFor(candidate);
        certificates.push(certificate);
        options.onProven?.(index, certificate);
        await nextTurn();
        if (options.shouldStop?.()) return { certificates: [], outOfMemory: false, stopped: true };
      }
      return { certificates, outOfMemory: false, stopped: false };
    };
  }
  const primesOf = (sent: WorkerResponse[]) =>
    sent.flatMap((response) => (response.type === "proven" || response.type === "batch" ? response.primes : []));

  it("sends each prime as soon as it's proven and checked, in order, then the batch", async () => {
    const clock = { now: 0 };
    const sent = await run(standInSieve(BATCH), REQUEST, null, { now: () => clock.now, prove: slowProver(clock, 150) });
    assert.deepEqual(sent.map((response) => response.type), ["proving", "proven", "proven", "proven", "batch"]);
    assert.deepEqual(primesOf(sent), BATCH, "every prime once, in order");
    const pieces = sent.filter((response) => response.type === "proven");
    assert.deepEqual(pieces.map((piece) => piece.primes), [[BELOW_BOUND, FIRST], [SECOND], [THIRD]]);
    assert.deepEqual(pieces.map((piece) => piece.findingDurationMs), [150, 150, 150]);
    assert.equal(sent.reduce((sum, response) => sum + ("foundCount" in response ? response.foundCount : 0), 0), 4);
  });

  it("sends no more than one piece every STREAM_INTERVAL_MS: fast proofs go together", async () => {
    const clock = { now: 0 };
    const sent = await run(standInSieve(BATCH), REQUEST, null, { now: () => clock.now, prove: slowProver(clock, 1) });
    assert.ok(STREAM_INTERVAL_MS > 3);
    assert.deepEqual(sent.map((response) => response.type), ["proving", "proven", "batch"]);
    assert.deepEqual(primesOf(sent), BATCH);
  });

  it("going back, sends pieces downward, each one ascending", async () => {
    const clock = { now: 0 };
    const sent = await run(standInSieve(BATCH), { ...REQUEST, direction: "prev", from: THIRD + 1n }, null, {
      now: () => clock.now,
      prove: slowProver(clock, 150),
    });
    const pieces = sent.filter((response) => response.type === "proven" || response.type === "batch");
    // the prime below a(13) needs no proof, so it goes with FIRST, the last to be proven; the batch has nothing left
    assert.deepEqual(pieces.map((piece) => piece.primes), [[THIRD], [SECOND], [BELOW_BOUND, FIRST], []]);
  });

  it("checks the rejected composites before proving anything, and stops at once if one doesn't hold", async () => {
    const asked: bigint[][] = [];
    const prime2039: RejectedComposite = { candidate: 2039n, evidence: 3, kind: "evidence" }; // a prime: wrong
    const sent = await run(standInSieve(BATCH, { rejected: [prime2039] }), REQUEST, null, {
      prove: async (candidates) => (asked.push(candidates), { certificates: [], outOfMemory: false, stopped: false }),
    });
    assert.deepEqual(sent.map((response) => response.type), ["error"]);
    assert.deepEqual(asked, [], "nothing proven, nothing shown");
  });

  it("stops proving at a certificate that doesn't hold, having shown only the primes before it", async () => {
    const clock = { now: 0 };
    const cache = new ProvenPrimeCache();
    const asked: bigint[] = [];
    const broken = (prime: bigint) => {
      asked.push(prime);
      const [first, ...rest] = CERTIFICATE_OF.get(prime)!;
      return prime === SECOND ? [{ ...first, pointX: first.pointX + 1n }, ...rest] : [first, ...rest];
    };
    const sent = await run(standInSieve(BATCH), REQUEST, null, {
      now: () => clock.now,
      prove: slowProver(clock, 150, broken),
      provenPrimes: cache,
    });
    assert.deepEqual(sent.map((response) => response.type), ["proving", "proven", "error"]);
    assert.deepEqual(primesOf(sent), [BELOW_BOUND, FIRST]);
    assert.equal(cache.has(SECOND), false);
    assert.deepEqual(asked, [FIRST, SECOND], "proving stopped there");
  });

  it("doesn't count primes kept from an earlier proof as found", async () => {
    const clock = { now: 0 };
    const cache = new ProvenPrimeCache();
    cache.add(FIRST);
    const sent = await run(standInSieve(BATCH), REQUEST, null, {
      now: () => clock.now,
      prove: slowProver(clock, 150),
      provenPrimes: cache,
    });
    assert.deepEqual(primesOf(sent), BATCH);
    assert.equal(sent.reduce((sum, response) => sum + ("foundCount" in response ? response.foundCount : 0), 0), 3);
  });
});

describe("computeBatch progress on the prime the list is waiting on (step 5d)", () => {
  const CERTIFIED = [10n ** 25n, 10n ** 26n].map(certifiedPrimeFrom);
  const [FIRST, SECOND] = CERTIFIED.map(({ prime }) => prime);
  const CERTIFICATE_OF = new Map(CERTIFIED.map(({ prime, steps }) => [prime, steps]));

  it("reports it at most every PROGRESS_INTERVAL_MS, with its elapsed time, digits and how far its chain has got", async () => {
    const clock = { now: 0 };
    const sent = await run(standInSieve([FIRST, SECOND]), REQUEST, null, {
      now: () => clock.now,
      // each prime: 10 runs of 300 ms, its chain going down 5 bits a run, then its certificate
      prove: async (candidates, options) => {
        const certificates = [];
        for (const [index, candidate] of candidates.entries()) {
          for (let run = 1; run <= 10; run++) {
            clock.now += 300;
            options.onProgress?.(index, candidate.toString(2).length - 5 * run);
          }
          const certificate = CERTIFICATE_OF.get(candidate)!;
          certificates.push(certificate);
          options.onProven?.(index, certificate);
        }
        return { certificates, outOfMemory: false, stopped: false };
      },
    });
    const progress = sent.filter((response) => response.type === "proving-progress");
    // 6 s of proving, reported at most once a second: about 6 reports, never one a run (20 runs)
    assert.ok(progress.length >= 4 && progress.length <= 7, `${progress.length} reports`);
    // the first for FIRST, at its first run: 300 ms in, its chain 5 bits down
    assert.deepEqual(progress[0], {
      type: "proving-progress",
      id: REQUEST.id,
      generation: REQUEST.generation,
      direction: "next",
      elapsedMs: 300,
      digits: FIRST.toString().length,
      reachedDigits: digitsOfBitLength(FIRST.toString(2).length - 5),
    });
    // the elapsed time starts again for SECOND: its last report is within its own 3 s
    assert.ok(progress.at(-1)!.elapsedMs <= 3000, `${progress.at(-1)!.elapsedMs} ms`);
    assert.equal(PROGRESS_INTERVAL_MS, 1000);
  });
});

describe("digitsOfBitLength", () => {
  it("is the fewest digits a number with that many bits can have", () => {
    for (const value of [1n, 9n, 10n, 1023n, 1024n, 10n ** 30n, 2n ** 100n - 1n, 2n ** 100n]) {
      const bits = value.toString(2).length;
      const fewest = (2n ** BigInt(bits - 1)).toString().length;
      assert.equal(digitsOfBitLength(bits), fewest, `${value}`);
    }
    assert.equal(digitsOfBitLength(0), 0);
  });
});
