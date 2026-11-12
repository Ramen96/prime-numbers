import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certifiedPrimeFrom } from "../../tests/support/curveCertificates.ts";
import type { CertificateStep } from "./primalityCertificate.ts";
import {
  certificatesFor,
  joinVerifications,
  SMALLEST_PRIME_WORTH_SHARING,
  splitIntoShares,
  VerificationPool,
  type VerificationRequest,
} from "./verificationPool.ts";
import { verifyBatch } from "./verifyPrimes.ts";
import type { RejectedComposite } from "./wasmSieve.ts";

/** A stand-in worker that verifies for real, or fails, and records what it was sent. */
function standInWorker(
  sent: bigint[][],
  options: {
    fails?: boolean;
    sentRejected?: RejectedComposite[][];
    sentCertificates?: VerificationRequest["certificates"][];
  } = {},
): Worker {
  const worker = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as ((event: { message: string; preventDefault(): void }) => void) | null,
    terminated: false,
    postMessage({ primes, rejected, certificates }: VerificationRequest) {
      sent.push(primes);
      options.sentRejected?.push(rejected);
      options.sentCertificates?.push(certificates);
      queueMicrotask(() => {
        if (options.fails) worker.onerror?.({ message: "failed to load", preventDefault() {} });
        else worker.onmessage?.({ data: { verification: verifyBatch(primes, rejected, certificates) } });
      });
    },
    terminate() {
      worker.terminated = true;
    },
  };
  return worker as unknown as Worker;
}

const BIG = SMALLEST_PRIME_WORTH_SHARING;
// primes just past 2^32: 4294967311, 4294967357, 4294967371, 4294967377, 4294967387, 4294967389
const BIG_PRIMES = [15n, 61n, 75n, 81n, 91n, 93n].map((offset) => BIG + offset);

describe("splitIntoShares", () => {
  it("splits into consecutive, even shares that rebuild the batch in order", () => {
    const batch = Array.from({ length: 500 }, (_, index) => index);
    for (const shareCount of [1, 2, 3, 7, 9]) {
      const shares = splitIntoShares(batch, shareCount);
      assert.equal(shares.length, shareCount);
      assert.deepEqual(shares.flat(), batch);
      const sizes = shares.map((share) => share.length);
      assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
    }
  });

  it("never makes an empty share", () => {
    assert.deepEqual(splitIntoShares([1, 2], 9), [[1], [2]]);
  });
});

describe("joinVerifications", () => {
  it("reports the first disputed prime in batch order", () => {
    const joined = joinVerifications([
      { verified: true },
      { verified: false, disputedPrime: 21n, verdict: "composite" },
      { verified: false, disputedPrime: 99n, verdict: "composite" },
    ]);
    assert.deepEqual(joined, { verified: false, disputedPrime: 21n, verdict: "composite" });
    assert.deepEqual(joinVerifications([{ verified: true }, { verified: true }]), { verified: true });
  });
});

describe("VerificationPool", () => {
  it("checks small primes inline, without starting workers", async () => {
    let started = 0;
    const pool = new VerificationPool(4, () => (started++, standInWorker([])));
    assert.deepEqual(await pool.verify([2n, 3n, 5n]), { verified: true });
    assert.equal(started, 0);
  });

  it("shares big primes between its workers, and every prime is checked once", async () => {
    const sent: bigint[][] = [];
    const pool = new VerificationPool(3, () => standInWorker(sent));
    assert.deepEqual(await pool.verify(BIG_PRIMES), { verified: true });
    assert.equal(sent.length, 3);
    assert.deepEqual(sent.flat(), BIG_PRIMES);
  });

  it("finds a composite whichever share it's in", async () => {
    const composite = BIG + 17n; // 4294967313 = 3 × 1431655771
    const pool = new VerificationPool(3, () => standInWorker([]));
    const batch = [...BIG_PRIMES.slice(0, 4), composite];
    assert.deepEqual(await pool.verify(batch), { verified: false, disputedPrime: composite, verdict: "composite" });
  });

  it("checks inline from then on if a worker fails, never skipping the check", async () => {
    let started = 0;
    const pool = new VerificationPool(2, () => (started++, standInWorker([], { fails: true })));
    assert.deepEqual(await pool.verify(BIG_PRIMES), { verified: true });
    const composite = BIG + 17n;
    assert.equal((await pool.verify([composite])).verified, false);
    assert.equal(started, 2, "no new workers after the failure");
  });

  it("checks inline with fewer than 2 workers", async () => {
    let started = 0;
    const pool = new VerificationPool(1, () => (started++, standInWorker([])));
    assert.deepEqual(await pool.verify(BIG_PRIMES), { verified: true });
    assert.equal(started, 0);
  });
});

describe("VerificationPool and rejected composites (Phase 4)", () => {
  // composites just past 2^32 with no factor up to 41 for most, and evidence that proves each
  const REJECTED: RejectedComposite[] = [
    { candidate: BIG + 17n, evidence: 3, kind: "evidence" }, // 3 × 1431655771
    { candidate: BIG * 3n, evidence: 2, kind: "evidence" }, // even
    { candidate: 4_294_967_297n, evidence: 3, kind: "evidence" }, // 2^32 + 1 = 641 × 6700417; 3 is a witness
  ];

  it("shares rejected composites between its workers too, and checks every one once", async () => {
    const sent: bigint[][] = [];
    const sentRejected: RejectedComposite[][] = [];
    const pool = new VerificationPool(3, () => standInWorker(sent, { sentRejected }));
    assert.deepEqual(await pool.verify(BIG_PRIMES, REJECTED), { verified: true });
    assert.deepEqual(sent.flat(), BIG_PRIMES);
    assert.deepEqual(sentRejected.flat(), REJECTED);
  });

  it("finds a rejected composite whose evidence doesn't hold, whichever share it's in", async () => {
    const wronglyRejected: RejectedComposite = { candidate: BIG_PRIMES[2], evidence: 7, kind: "evidence" }; // a prime
    const pool = new VerificationPool(3, () => standInWorker([]));
    assert.deepEqual(await pool.verify(BIG_PRIMES.slice(0, 2), [...REJECTED, wronglyRejected]), {
      verified: false,
      disputedComposite: wronglyRejected.candidate,
      evidence: 7,
      kind: "evidence",
    });
  });

  it("checks rejected composites even in a batch with no primes", async () => {
    const pool = new VerificationPool(3, () => standInWorker([]));
    assert.deepEqual(await pool.verify([], REJECTED), { verified: true });
    assert.equal((await pool.verify([], [{ candidate: BIG_PRIMES[0], evidence: 2, kind: "evidence" }])).verified, false);
  });

  it("checks small ones inline", async () => {
    let started = 0;
    const pool = new VerificationPool(4, () => (started++, standInWorker([])));
    assert.deepEqual(await pool.verify([7n], [{ candidate: 9n, evidence: 3, kind: "evidence" }]), { verified: true });
    assert.equal((await pool.verify([7n], [{ candidate: 11n, evidence: 3, kind: "evidence" }])).verified, false);
    assert.equal(started, 0);
  });
});

describe("VerificationPool and certificates (Phase 5)", () => {
  // primes past a(13), each with a real certificate
  const CERTIFIED = [10n ** 25n, 10n ** 26n, 10n ** 27n, 10n ** 28n, 10n ** 29n, 10n ** 30n].map(certifiedPrimeFrom);
  const PRIMES = CERTIFIED.map(({ prime }) => prime);
  const CERTIFICATES = new Map(CERTIFIED.map(({ prime, steps }) => [prime, steps]));

  it("sends each share only its own primes' certificates", async () => {
    const sent: bigint[][] = [];
    const sentCertificates: VerificationRequest["certificates"][] = [];
    const pool = new VerificationPool(3, () => standInWorker(sent, { sentCertificates }));
    assert.deepEqual(await pool.verify(PRIMES, [], CERTIFICATES), { verified: true });
    assert.equal(sent.length, 3);
    sent.forEach((share, index) => assert.deepEqual([...sentCertificates[index].keys()], share));
  });

  it("finds a broken certificate in the last share", async () => {
    const last = CERTIFIED.at(-1)!;
    const [first, ...rest] = last.steps;
    const broken = new Map<bigint, readonly CertificateStep[]>(CERTIFICATES);
    broken.set(last.prime, [{ ...first, pointX: first.pointX + 1n }, ...rest]);
    const pool = new VerificationPool(3, () => standInWorker([]));
    const verification = await pool.verify(PRIMES, [], broken);
    assert.equal(verification.verified, false);
    assert.equal("disputedPrime" in verification && verification.disputedPrime, last.prime);
    assert.equal("verdict" in verification && verification.verdict, "certificate-invalid");
  });

  it("refuses a prime past a(13) with no certificate, in workers or inline", async () => {
    const withoutLast = new Map(CERTIFICATES);
    withoutLast.delete(PRIMES.at(-1)!);
    const expected = { verified: false, disputedPrime: PRIMES.at(-1), verdict: "beyond-proven-bound" };
    assert.deepEqual(await new VerificationPool(3, () => standInWorker([])).verify(PRIMES, [], withoutLast), expected);
    assert.deepEqual(await new VerificationPool(1, () => standInWorker([])).verify(PRIMES, [], withoutLast), expected);
  });

  it("checks certificates inline when a worker fails", async () => {
    const pool = new VerificationPool(2, () => standInWorker([], { fails: true }));
    assert.deepEqual(await pool.verify(PRIMES, [], CERTIFICATES), { verified: true });
  });
});

describe("certificatesFor", () => {
  it("keeps only the certificates of the primes given", () => {
    const steps = (number: bigint): CertificateStep[] => [
      { number, curveA: 0n, curveB: 0n, pointX: 0n, pointY: 0n, orderPrime: 0n },
    ];
    const all = new Map([5n, 7n, 11n].map((prime) => [prime, steps(prime)]));
    assert.deepEqual(certificatesFor([7n, 13n], all), new Map([[7n, steps(7n)]]));
  });
});
