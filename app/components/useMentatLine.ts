"use client";

import { useEffect, useState } from "react";
import { maybeMentatLine } from "@/lib/mentatLines";

/**
 * A Mentat line (or, most of the time, null) for as long as `active` stays
 * true, picked once each time it turns true, never re-rolled on a re-render.
 * Picked in an effect, so only in the browser after mount: the server's HTML
 * and the first render always agree (no line), so hydration can't mismatch.
 */
export function useMentatLine(lines: readonly string[], active: boolean): string | null {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the pick must happen after mount, in the browser
    setLine(active ? maybeMentatLine(lines) : null);
  }, [active, lines]);
  return active ? line : null;
}
