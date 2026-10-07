"use client";

import { useSyncExternalStore } from "react";
import { getServerSnapshot, getSnapshot, subscribe } from "./personalDataStore.ts";

export {
  dismissStorageNotice,
  markStorageNoticeSeen,
  removeFavorite,
  reportVisiblePrime,
  resetRecords,
  toggleFavorite,
} from "./personalDataStore.ts";

/**
 * Favorites and records from this browser's storage. The server render and the
 * first client render both see the empty server snapshot, so the static HTML
 * and hydration match; stored data appears right after.
 */
export function usePersonalData() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
