"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { describeCheck, describeUnreadable } from "../certificateCheck.ts";
import { readCertificate } from "../certificateExport.ts";
import type { CertificateCheck } from "./primalityCertificate.ts";
import { CERTIFICATE_CHECK_WORKER_NAME } from "./workerNames.ts";

export type CertificateCheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "done"; valid: boolean; message: string }
  | { kind: "cancelled" };

/**
 * Reads a pasted or uploaded certificate, and checks it with checkCertificate in
 * a worker of its own (one per check, ended when it answers or on Cancel).
 */
export function useCertificateCheck() {
  const [state, setState] = useState<CertificateCheckState>({ kind: "idle" });
  const workerRef = useRef<Worker | null>(null);

  const endWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const check = useCallback(
    (text: string) => {
      endWorker();
      const read = readCertificate(text);
      if (!read.readable) {
        setState({ kind: "done", valid: false, message: describeUnreadable(read) });
        return;
      }
      const worker = new Worker(new URL("./certificateCheck.worker.ts", import.meta.url), {
        type: "module",
        name: CERTIFICATE_CHECK_WORKER_NAME,
      });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<CertificateCheck>) => {
        if (workerRef.current !== worker) return;
        endWorker();
        setState({ kind: "done", valid: event.data.valid, message: describeCheck(read.prime, read.steps, event.data) });
      };
      worker.onerror = (errorEvent) => {
        if (workerRef.current !== worker) return;
        console.error("certificate check worker crashed:", errorEvent.message);
        endWorker();
        setState({ kind: "done", valid: false, message: "The check stopped unexpectedly, so nothing was decided." });
      };
      setState({ kind: "checking" });
      worker.postMessage({ prime: read.prime, steps: read.steps });
    },
    [endWorker],
  );

  const cancel = useCallback(() => {
    if (!workerRef.current) return;
    endWorker();
    setState({ kind: "cancelled" });
  }, [endWorker]);

  useEffect(() => endWorker, [endWorker]);

  return { state, check, cancel };
}
