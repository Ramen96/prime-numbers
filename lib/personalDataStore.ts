// The browser side of personal data: one in-memory copy shared by the page,
// kept in step with localStorage and with other tabs. React reads it through
// useSyncExternalStore (see usePersonalData), which renders the server's empty
// snapshot first, so stored data appears only after mount and hydration matches.

import {
  EMPTY_PERSONAL_DATA,
  PERSONAL_DATA_STORAGE_KEY,
  readStorageNoticeSeen,
  readStoredPersonalData,
  savePersonalData,
  saveStorageNoticeSeen,
  withFavoriteAdded,
  withFavoriteRemoved,
  withRecordsCleared,
  withRecordsMerged,
  isFavorite,
  type KeyValueStorage,
  type PersonalData,
  type PersonalRecords,
  type SaveResult,
} from "./personalData.ts";
import {
  furthestScrollWasBeaten,
  recordsAreEqual,
  recordVisiblePrime,
  type RecordSession,
} from "./personalRecords.ts";

export interface PersonalDataSnapshot {
  /**
   * False in the server render (and the first client render, which must match
   * it); true once this browser's storage has been read. Lets a page show a
   * neutral placeholder instead of flashing "no favorites" before mount.
   */
  isFromThisBrowser: boolean;
  data: PersonalData;
  /** The last save failed because storage is full; changes aren't being kept. */
  storageIsFull: boolean;
  /** Set once per page load, the first time an existing furthest-scroll record is beaten. */
  furthestScrollRecordBeaten: boolean;
  /**
   * Show the storage notice: it hadn't been seen when the page loaded (or
   * storage can't be read), and hasn't been dismissed since. Decided at load,
   * so saving the "seen" flag doesn't hide it mid-visit.
   */
  showStorageNotice: boolean;
}

const SERVER_SNAPSHOT: PersonalDataSnapshot = {
  isFromThisBrowser: false,
  data: EMPTY_PERSONAL_DATA,
  storageIsFull: false,
  furthestScrollRecordBeaten: false,
  showStorageNotice: false,
};

/** Records change on almost every scroll; save them at most this often. */
const RECORD_SAVE_INTERVAL_MS = 1000;

let snapshot: PersonalDataSnapshot | null = null;
const listeners = new Set<() => void>();
/** Records seen since the last save. */
let unsavedRecords: PersonalRecords | null = null;
let recordSaveTimer: ReturnType<typeof setTimeout> | undefined;
let lastRecordSaveTime = 0;
let celebratedThisPageLoad = false;
/**
 * The furthest-scroll record as it was when the page loaded. "New record!" is
 * for beating that, not for beating a record set moments ago on this same
 * visit (on a first visit, the primes on screen at load set the first record).
 */
let furthestScrollAtPageLoad: string | null = null;

/** localStorage, or null where even touching it throws (blocked site data, some private modes). */
function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function currentSnapshot(): PersonalDataSnapshot {
  if (!snapshot) {
    const storage = browserStorage();
    snapshot = {
      ...SERVER_SNAPSHOT,
      isFromThisBrowser: true,
      data: readStoredPersonalData(storage) ?? EMPTY_PERSONAL_DATA,
      // Unreadable storage counts as unseen: the notice may then show on every visit.
      showStorageNotice: readStorageNoticeSeen(storage) !== true,
    };
    furthestScrollAtPageLoad = snapshot.data.records.furthestScroll;
  }
  return snapshot;
}

function publish(nextSnapshot: PersonalDataSnapshot) {
  snapshot = nextSnapshot;
  for (const listener of listeners) listener();
}

/**
 * Applies a change to what's stored now (not just this tab's copy), so a
 * change made in another tab meanwhile isn't overwritten. Without storage,
 * changes still apply to this page; they just don't persist.
 */
function applyAndSave(change: (data: PersonalData) => PersonalData) {
  const storage = browserStorage();
  const latest = readStoredPersonalData(storage) ?? currentSnapshot().data;
  const withUnsavedRecords = unsavedRecords ? withRecordsMerged(latest, unsavedRecords) : latest;
  const nextData = change(withUnsavedRecords);
  const result: SaveResult = savePersonalData(storage, nextData);
  return { nextData, result };
}

function storageIsFullAfter(result: SaveResult): boolean {
  if (result === "storage-full") return true;
  if (result === "saved") return false;
  return currentSnapshot().storageIsFull;
}

// ── reading ──────────────────────────────────────────────────────────────

function handleStorageEvent(event: StorageEvent) {
  if (event.key !== PERSONAL_DATA_STORAGE_KEY && event.key !== null) return;
  const stored = readStoredPersonalData(browserStorage()) ?? EMPTY_PERSONAL_DATA;
  const data = unsavedRecords ? withRecordsMerged(stored, unsavedRecords) : stored;
  publish({ ...currentSnapshot(), data });
}

export function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("storage", handleStorageEvent);
    window.addEventListener("pagehide", saveRecordsNow);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", handleStorageEvent);
      window.removeEventListener("pagehide", saveRecordsNow);
    }
  };
}

export const getSnapshot = currentSnapshot;
export const getServerSnapshot = () => SERVER_SNAPSHOT;

// ── favorites ────────────────────────────────────────────────────────────

export function toggleFavorite(prime: bigint) {
  const { nextData, result } = applyAndSave((data) =>
    isFavorite(data, prime) ? withFavoriteRemoved(data, prime) : withFavoriteAdded(data, prime),
  );
  unsavedRecords = null;
  publish({ ...currentSnapshot(), data: nextData, storageIsFull: storageIsFullAfter(result) });
}

export function removeFavorite(prime: bigint) {
  const { nextData, result } = applyAndSave((data) => withFavoriteRemoved(data, prime));
  unsavedRecords = null;
  publish({ ...currentSnapshot(), data: nextData, storageIsFull: storageIsFullAfter(result) });
}

// ── records ──────────────────────────────────────────────────────────────

/** Called whenever the largest prime on screen changes. Saves at most once a second. */
export function reportVisiblePrime(largestVisiblePrime: bigint, session: RecordSession) {
  const knownRecords = unsavedRecords ?? currentSnapshot().data.records;
  const updatedRecords = recordVisiblePrime(knownRecords, session, largestVisiblePrime);
  if (recordsAreEqual(updatedRecords, knownRecords)) return;
  unsavedRecords = updatedRecords;

  if (recordSaveTimer !== undefined) return; // a save is already scheduled
  const waitMs = Math.max(0, lastRecordSaveTime + RECORD_SAVE_INTERVAL_MS - Date.now());
  recordSaveTimer = setTimeout(saveRecordsNow, waitMs);
}

export function saveRecordsNow() {
  clearTimeout(recordSaveTimer);
  recordSaveTimer = undefined;
  if (!unsavedRecords) return;

  const recordsAtPageLoad = { furthestScroll: furthestScrollAtPageLoad, biggestPrimeVisited: null };
  const { nextData, result } = applyAndSave((data) => data);
  unsavedRecords = null;
  lastRecordSaveTime = Date.now();

  const beaten = !celebratedThisPageLoad && furthestScrollWasBeaten(recordsAtPageLoad, nextData.records);
  if (beaten) celebratedThisPageLoad = true;
  publish({
    ...currentSnapshot(),
    data: nextData,
    storageIsFull: storageIsFullAfter(result),
    furthestScrollRecordBeaten: currentSnapshot().furthestScrollRecordBeaten || beaten,
  });
}

export function resetRecords() {
  clearTimeout(recordSaveTimer);
  recordSaveTimer = undefined;
  unsavedRecords = null;
  furthestScrollAtPageLoad = null; // starting over: nothing to beat until the next visit
  const { nextData, result } = applyAndSave(withRecordsCleared);
  publish({ ...currentSnapshot(), data: nextData, storageIsFull: storageIsFullAfter(result) });
}

// ── the storage notice ───────────────────────────────────────────────────

/** Called once the notice is on screen: it won't show again on later visits, OK or not. */
export function markStorageNoticeSeen() {
  saveStorageNoticeSeen(browserStorage()); // if storage is unavailable, it shows again next visit
}

/** OK: hide it for the rest of this visit. */
export function dismissStorageNotice() {
  publish({ ...currentSnapshot(), showStorageNotice: false });
}
