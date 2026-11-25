"use client";

import { useEffect, useState } from "react";
import { useGpuPreference, webGpuAvailable } from "@/lib/gpuPreference";
import { describeGpuRow } from "@/lib/gpuRow";
import type { GpuStrippingStatus } from "@/lib/primes/protocol";
import styles from "./GpuSwitch.module.scss";

interface Props {
  /** What the list's worker last said about the GPU. */
  status: GpuStrippingStatus | null;
  onSwitch: (on: boolean) => void;
}

/**
 * The GPU switch and what the GPU is doing, beside the thread count in the stats
 * (“threads · GPU”), so it takes no row of its own: on phones every row is list
 * height. The words show only where the box has room for them (desktop, and
 * from 640 px); elsewhere they're still the switch's description for screen readers.
 */
export function GpuSwitchAndStatus({ status, onSwitch }: Props) {
  const preferred = useGpuPreference();
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let current = true;
    void webGpuAvailable().then((found) => current && setAvailable(found));
    return () => {
      current = false;
    };
  }, []);
  const row = describeGpuRow(preferred, available, status);
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={row.checked}
        aria-label="Use the GPU for proofs"
        aria-describedby="gpu-status"
        disabled={row.disabled}
        onClick={() => onSwitch(!preferred)}
        className={styles.switch}
        data-testid="gpu-switch"
      >
        <span className={styles.knob} />
      </button>
      <span id="gpu-status" className="hidden min-w-0 @min-[11.75rem]:inline" data-testid="gpu-row-text">
        {row.text}
      </span>
    </>
  );
}
