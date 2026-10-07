"use client";

import { useId } from "react";
import { removeFavorite, resetRecords, usePersonalData } from "@/lib/usePersonalData";
import { FavoritesList } from "./FavoritesList";
import { ResetRecordsControl } from "./ResetRecordsControl";
import { WrappableNumber } from "./WrappableNumber";

const numberFormatter = new Intl.NumberFormat("en-US");

function storedPrime(decimal: string | null): bigint | null {
  return decimal === null ? null : BigInt(decimal);
}

/**
 * The /favorites page's content: the visitor's records and favorites, read
 * from this browser's storage after mount (the server renders only the page
 * around it). Changes in other tabs show up live.
 */
export function FavoritesManager() {
  const recordsHeadingId = useId();
  const favoritesHeadingId = useId();
  const { isFromThisBrowser, data } = usePersonalData();
  const { favorites, records } = data;

  return (
    <>
      <section aria-labelledby={recordsHeadingId} className="mt-6 border-t border-rule py-4">
        <h2 id={recordsHeadingId} className="mb-2 text-xs tracking-widest text-muted uppercase">
          Your records
        </h2>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm tabular-nums">
          <dt className="text-muted">furthest scroll</dt>
          <dd>{isFromThisBrowser ? <WrappableNumber value={storedPrime(records.furthestScroll)} /> : "—"}</dd>
          <dt className="text-muted">biggest visited</dt>
          <dd>
            {isFromThisBrowser ? <WrappableNumber value={storedPrime(records.biggestPrimeVisited)} /> : "—"}
          </dd>
        </dl>
        <div className="mt-2">
          <ResetRecordsControl onResetRecords={resetRecords} />
        </div>
      </section>

      <section aria-labelledby={favoritesHeadingId} className="flex min-h-0 flex-1 flex-col">
        <h2
          id={favoritesHeadingId}
          className="mb-2 text-xs tracking-widest text-muted uppercase"
          data-testid="favorites-count"
        >
          {isFromThisBrowser
            ? `${numberFormatter.format(favorites.length)} ${favorites.length === 1 ? "favorite" : "favorites"}`
            : "Favorites"}
        </h2>
        {!isFromThisBrowser ? (
          <p className="text-sm text-muted">Loading your favorites…</p>
        ) : favorites.length === 0 ? (
          <p className="text-sm text-muted">
            No favorites yet. Tap the ☆ next to any prime in the list to add it here.
          </p>
        ) : (
          <FavoritesList favorites={favorites} onRemoveFavorite={removeFavorite} />
        )}
      </section>
    </>
  );
}
