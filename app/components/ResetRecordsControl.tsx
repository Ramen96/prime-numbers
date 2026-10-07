"use client";

import { useEffect, useRef, useState } from "react";

const SMALL_BUTTON_CLASSES =
  "min-h-11 rounded-md px-3 text-sm focus-visible:outline-2 focus-visible:outline-(--heat-text)";

/** "Reset records", with a confirmation step so it can't happen by accident. */
export function ResetRecordsControl({ onResetRecords }: { onResetRecords: () => void }) {
  const [isConfirming, setIsConfirming] = useState(false);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const wasConfirmingRef = useRef(false);

  // Keep keyboard focus in a sensible place as the confirmation opens and closes.
  useEffect(() => {
    if (isConfirming) confirmButtonRef.current?.focus();
    else if (wasConfirmingRef.current) resetButtonRef.current?.focus();
    wasConfirmingRef.current = isConfirming;
  }, [isConfirming]);

  if (!isConfirming) {
    return (
      <button
        ref={resetButtonRef}
        type="button"
        onClick={() => setIsConfirming(true)}
        className={`${SMALL_BUTTON_CLASSES} -ml-3 text-muted underline underline-offset-2 hover:text-foreground`}
      >
        Reset records
      </button>
    );
  }

  return (
    <div role="group" aria-label="Confirm resetting records" className="text-sm">
      <p className="mb-1">Reset your furthest scroll and biggest prime visited?</p>
      <div className="flex gap-2">
        <button
          ref={confirmButtonRef}
          type="button"
          onClick={() => {
            onResetRecords();
            setIsConfirming(false);
          }}
          className={`${SMALL_BUTTON_CLASSES} bg-(--hot-surface) font-medium text-white`}
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => setIsConfirming(false)}
          className={`${SMALL_BUTTON_CLASSES} border border-rule`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
