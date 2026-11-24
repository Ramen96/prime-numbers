"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProvingStatus } from "../provingStatus.ts";
import { randomPrimeOutcome, randomPrimeRequest } from "../randomPrime.ts";
import { randomNumberWithDigits } from "../randomStart.ts";
import type { CertificateStep } from "./primalityCertificate.ts";
import type { ProvenPrimeCertificate, WorkerResponse } from "./protocol.ts";
import { PRIME_WORKER_NAME } from "./workerNames.ts";
import { gpuPreferred } from "../gpuPreference.ts";

export type RandomPrimeState =
  | { kind: "idle" }
  /** `proving` is null until the worker starts proving (while it sieves). */
  | { kind: "finding"; digits: number; proving: ProvingStatus | null }
  | { kind: "found"; digits: number; prime: bigint; certificate: readonly CertificateStep[]; elapsedMs: number }
  | { kind: "gave-up" }
  | { kind: "memory-limit" }
  | { kind: "error"; message: string };

export interface RandomPrime {
  state: RandomPrimeState;
  /** Draws a random number with `digits` digits, and finds, proves and checks the first prime from it. */
  find: (digits: number) => void;
  /** Stops finding: pauses a proof, or ends the worker while it sieves (a Wasm call can't be interrupted). */
  giveUp: () => void;
}

/**
 * The random-prime page's own prime worker (the same primes.worker.ts the list
 * uses, started on the first find and ended when the page goes), one request at
 * a time. A prime is shown only with the certificate the worker checked.
 */
export function useRandomPrime(): RandomPrime {
  const [state, setState] = useState<RandomPrimeState>({ kind: "idle" });
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef<{
    id: number;
    digits: number;
    startedAt: number;
    proving: boolean;
    primes: bigint[];
    certificates: ProvenPrimeCertificate[];
  } | null>(null);
  const nextIdRef = useRef(1);

  const send = useCallback((digits: number, startedAt: number) => {
    const worker = workerRef.current;
    if (!worker) return;
    const id = nextIdRef.current++;
    requestRef.current = { id, digits, startedAt, proving: false, primes: [], certificates: [] };
    worker.postMessage(randomPrimeRequest(id, randomNumberWithDigits(digits), gpuPreferred()));
  }, []);

  const handleResponse = useCallback(
    (response: WorkerResponse) => {
      const request = requestRef.current;
      if (!request || response.id !== request.id) return; // from a request given up on
      switch (response.type) {
        case "proving":
          request.proving = true;
          setState({ kind: "finding", digits: request.digits, proving: { elapsedMs: 0, digits: null, reachedDigits: null } });
          return;
        case "proving-progress":
          setState({
            kind: "finding",
            digits: request.digits,
            proving: { elapsedMs: response.elapsedMs, digits: response.digits, reachedDigits: response.reachedDigits },
          });
          return;
        case "proven":
        case "batch":
          request.primes.push(...response.primes);
          request.certificates.push(...(response.certificates ?? []));
          if (response.type === "proven") return;
          break;
        case "paused":
          requestRef.current = null;
          setState({ kind: "gave-up" });
          return;
        case "memory-limit":
          requestRef.current = null;
          setState({ kind: "memory-limit" });
          return;
        case "error":
          requestRef.current = null;
          setState({ kind: "error", message: response.message });
          return;
        default:
          return; // building base primes, or who strips curve orders: nothing to show (the GPU from step 11e)
      }
      const outcome = randomPrimeOutcome(request.digits, request.primes, request.certificates);
      if (outcome.kind === "draw-again") {
        send(request.digits, request.startedAt);
        return;
      }
      requestRef.current = null;
      setState(
        outcome.kind === "found"
          ? {
              kind: "found",
              digits: request.digits,
              prime: outcome.prime,
              certificate: outcome.certificate,
              elapsedMs: performance.now() - request.startedAt,
            }
          : { kind: "error", message: outcome.message },
      );
    },
    [send],
  );

  const startWorker = useCallback(() => {
    const worker = new Worker(new URL("./primes.worker.ts", import.meta.url), { type: "module", name: PRIME_WORKER_NAME });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => handleResponse(event.data);
    worker.onerror = (errorEvent) => {
      // a worker ended while its script loaded fails its import: that's not a crash of one in use
      if (workerRef.current !== worker) return;
      console.error("prime worker crashed:", errorEvent.message);
      requestRef.current = null;
      setState({ kind: "error", message: "The prime worker stopped unexpectedly." });
    };
    workerRef.current = worker;
  }, [handleResponse]);

  const find = useCallback(
    (digits: number) => {
      if (requestRef.current) return; // one at a time
      if (!workerRef.current) startWorker();
      setState({ kind: "finding", digits, proving: null });
      send(digits, performance.now());
    },
    [send, startWorker],
  );

  const giveUp = useCallback(() => {
    const request = requestRef.current;
    if (!request) return;
    if (request.proving) {
      workerRef.current?.postMessage({ type: "pause", id: request.id }); // answered with "paused"
      return;
    }
    // still sieving: only ending the worker interrupts it; the next find starts a fresh one
    requestRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    setState({ kind: "gave-up" });
  }, []);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  return { state, find, giveUp };
}
