"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PrimeCheckAnswer } from "../primeCheck.ts";
import type { ProvingStatus } from "../provingStatus.ts";
import type { PrimeCheckRequest, PrimeCheckResponse } from "./primeChecker.ts";
import { PRIME_CHECK_WORKER_NAME } from "./workerNames.ts";
import { gpuPreferred } from "../gpuPreference.ts";

type ProbablyPrime = Extract<PrimeCheckAnswer, { kind: "probably-prime" }>;

export type PrimeCheckState =
  | { kind: "idle" }
  | { kind: "checking"; value: bigint }
  | { kind: "answered"; answer: PrimeCheckAnswer; elapsedMs: number }
  /** Proving a probable prime: `answer` is what's known until the proof is done. */
  | { kind: "proving"; answer: ProbablyPrime; proving: ProvingStatus }
  /**
   * Given up. On a proof, `answer` is the probable prime, and proving it again
   * resumes the chain (`provingMs` so far); on a check, nothing is known (null).
   */
  | { kind: "gave-up"; value: bigint; answer: ProbablyPrime | null; provingMs: number }
  | { kind: "memory-limit"; value: bigint }
  /** An answer or certificate that didn't hold when checked again: nothing about the number is shown. */
  | { kind: "disputed"; value: bigint; stage: "check" | "proof" }
  | { kind: "error"; message: string };

export interface PrimeCheck {
  state: PrimeCheckState;
  /** Checks `value`, short of a proof. Gives up on anything running first. */
  check: (value: bigint) => void;
  /** Proves the probable prime being shown (answered, or given up on while proving). */
  prove: () => void;
  /** Pauses a proof (its chain kept), or ends the worker during a check (a Wasm call can't be interrupted). */
  giveUp: () => void;
}

/**
 * The prime checker's worker (primeCheck.worker.ts), started on the first check
 * and ended when the page goes, one request at a time. Only answers the worker
 * re-checked reach the state; responses to a request given up on are ignored.
 */
export function usePrimeCheck(): PrimeCheck {
  const [state, setState] = useState<PrimeCheckState>({ kind: "idle" });
  // the state as last rendered, for prove() to read in a click handler
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef<{ id: number; type: "check" | "prove"; value: bigint; provingMsBefore: number } | null>(null);
  const nextIdRef = useRef(1);

  const handleResponse = useCallback((response: PrimeCheckResponse) => {
    const request = requestRef.current;
    if (!request || response.id !== request.id) return; // from a request given up on
    switch (response.type) {
      case "proving-progress":
        setState((current) =>
          current.kind === "proving"
            ? { ...current, proving: { elapsedMs: response.elapsedMs, digits: response.digits, reachedDigits: response.reachedDigits } }
            : current,
        );
        return;
      case "answer":
        requestRef.current = null;
        setState({ kind: "answered", answer: response.answer, elapsedMs: response.elapsedMs });
        return;
      case "paused":
        requestRef.current = null;
        setState((current) => ({
          kind: "gave-up",
          value: request.value,
          answer: current.kind === "proving" ? current.answer : { kind: "probably-prime", value: request.value },
          provingMs: current.kind === "proving" ? current.proving.elapsedMs : request.provingMsBefore,
        }));
        return;
      case "memory-limit":
        requestRef.current = null;
        setState({ kind: "memory-limit", value: request.value });
        return;
      case "disputed":
        requestRef.current = null;
        setState({ kind: "disputed", value: response.value, stage: response.stage });
        return;
      case "error":
        requestRef.current = null;
        setState({ kind: "error", message: response.message });
        return;
      case "stripping":
        return; // who strips curve orders (shown from step 11e)
    }
  }, []);

  const startWorker = useCallback(() => {
    const worker = new Worker(new URL("./primeCheck.worker.ts", import.meta.url), { type: "module", name: PRIME_CHECK_WORKER_NAME });
    worker.onmessage = (event: MessageEvent<PrimeCheckResponse>) => handleResponse(event.data);
    worker.onerror = (errorEvent) => {
      // a worker ended while its script loaded fails its import: that's not a crash of one in use
      if (workerRef.current !== worker) return;
      console.error("prime check worker crashed:", errorEvent.message);
      requestRef.current = null;
      setState({ kind: "error", message: "The prime checker stopped unexpectedly." });
    };
    workerRef.current = worker;
    return worker;
  }, [handleResponse]);

  const endWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  /** Stops whatever is running: a proof is paused (its chain kept), a check ends the worker. */
  const stopRunning = useCallback(() => {
    const request = requestRef.current;
    if (!request) return;
    requestRef.current = null;
    if (request.type === "prove") workerRef.current?.postMessage({ type: "pause", id: request.id } satisfies PrimeCheckRequest);
    else endWorker();
  }, [endWorker]);

  const send = useCallback(
    (type: "check" | "prove", value: bigint, provingMsBefore = 0) => {
      const worker = workerRef.current ?? startWorker();
      const id = nextIdRef.current++;
      requestRef.current = { id, type, value, provingMsBefore };
      const request: PrimeCheckRequest = type === "prove" ? { type, id, value, useGpu: gpuPreferred() } : { type, id, value };
      worker.postMessage(request);
    },
    [startWorker],
  );

  const check = useCallback(
    (value: bigint) => {
      stopRunning();
      setState({ kind: "checking", value });
      send("check", value);
    },
    [send, stopRunning],
  );

  const prove = useCallback(() => {
    const current = stateRef.current;
    const answer =
      current.kind === "answered" && current.answer.kind === "probably-prime"
        ? current.answer
        : current.kind === "gave-up"
          ? current.answer
          : null;
    if (!answer || requestRef.current) return;
    const provingMs = current.kind === "gave-up" ? current.provingMs : 0;
    setState({ kind: "proving", answer, proving: { elapsedMs: provingMs, digits: null, reachedDigits: null } });
    send("prove", answer.value, provingMs);
  }, [send]);

  const giveUp = useCallback(() => {
    const request = requestRef.current;
    if (!request) return;
    if (request.type === "prove") {
      // answered with "paused", which keeps the probable prime on show
      workerRef.current?.postMessage({ type: "pause", id: request.id } satisfies PrimeCheckRequest);
      return;
    }
    requestRef.current = null;
    endWorker();
    setState({ kind: "gave-up", value: request.value, answer: null, provingMs: 0 });
  }, [endWorker]);

  useEffect(() => endWorker, [endWorker]);

  return { state, check, prove, giveUp };
}
