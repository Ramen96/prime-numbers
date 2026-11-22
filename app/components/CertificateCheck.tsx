"use client";

import { useState, type ChangeEvent, type SubmitEvent } from "react";
import { useCertificateCheck } from "@/lib/primes/useCertificateCheck";

const BUTTON_CLASSES =
  "h-11 rounded-md border border-rule px-4 text-sm font-medium hover:border-foreground focus-visible:outline-2 focus-visible:outline-(--heat-text) disabled:text-muted";

/**
 * The random-prime page's “Check a certificate”: paste one, or choose a file, in
 * either download format, and checkCertificate decides (useCertificateCheck).
 */
export function CertificateCheck() {
  const { state, check, cancel } = useCertificateCheck();
  const [text, setText] = useState("");
  const checking = state.kind === "checking";

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    check(text);
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const contents = await file.text();
    setText(contents);
    check(contents);
    event.target.value = ""; // the same file can be chosen again
  };

  return (
    <section aria-labelledby="check-a-certificate" data-testid="certificate-check">
      <h2 id="check-a-certificate">Check a certificate</h2>
      <p>
        Paste a certificate from this page, as JSON or text, or choose a downloaded file. It’s checked by the same
        checker that checks every prime the site shows. That shows whether the certificate proves its number prime; it
        says nothing about where the certificate came from.
      </p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="certificate-text" className="mb-1 block text-sm text-muted">
          Certificate (JSON or text)
        </label>
        <textarea
          id="certificate-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          spellCheck={false}
          className="block w-full rounded-md border border-rule bg-background p-3 font-mono text-xs focus-visible:outline-2 focus-visible:outline-(--heat-text)"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="submit" disabled={checking} className={BUTTON_CLASSES}>
            Check certificate
          </button>
          <label className={`${BUTTON_CLASSES} inline-flex cursor-pointer items-center focus-within:outline-2 focus-within:outline-(--heat-text)`}>
            Choose a file
            <input type="file" accept=".json,.txt,application/json,text/plain" onChange={handleFile} className="sr-only" />
          </label>
          {checking && (
            <button type="button" onClick={cancel} className={BUTTON_CLASSES}>
              Cancel
            </button>
          )}
        </div>
      </form>
      <p
        role="status"
        className={`mt-3 min-h-6 text-sm ${state.kind === "done" && state.valid ? "font-semibold" : ""}`}
        data-testid="certificate-check-result"
        data-valid={state.kind === "done" ? String(state.valid) : undefined}
      >
        {state.kind === "checking"
          ? "Checking…"
          : state.kind === "cancelled"
            ? "Cancelled: nothing was decided."
            : state.kind === "done"
              ? state.message
              : ""}
      </p>
    </section>
  );
}
