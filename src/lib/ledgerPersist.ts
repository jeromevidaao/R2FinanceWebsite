/**
 * IndexedDB persistence for the local ledger snapshot.
 * Keeps HTTP light: UI hydrates from disk first, then applies deltas.
 *
 * Note: snapshot type is structural (matches LedgerData) to avoid a circular
 * import with dataStore.ts.
 */

const DB_NAME = 'r2finance';
const DB_VERSION = 1;
const STORE = 'kv';
const SNAPSHOT_KEY = 'ledger_snapshot_v1';
const META_KEY = 'ledger_meta_v1';

export type LedgerMeta = {
  /** Server cursor for GET /v1/sync/changes?since= */
  cursor: number;
  /** Wall clock of last successful full sync (heal drift). */
  lastFullAt: number;
  /** Wall clock of last successful any sync. */
  lastSyncedAt: number;
};

/** Structural snapshot — same shape as dataStore.LedgerData. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LedgerSnapshot = {
  plan: unknown;
  stats: unknown;
  accounts: unknown[];
  groups: unknown[];
  categories: unknown[];
  payees: unknown[];
  transactions: unknown[];
  loadedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb open failed'));
  });
}

function idbGet<T>(key: string): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

function idbSet(key: string, value: unknown): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function idbDel(key: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export async function loadSnapshot(): Promise<LedgerSnapshot | null> {
  try {
    return await idbGet<LedgerSnapshot>(SNAPSHOT_KEY);
  } catch {
    return null;
  }
}

export async function saveSnapshot(data: LedgerSnapshot): Promise<void> {
  try {
    await idbSet(SNAPSHOT_KEY, data);
  } catch {
    // Quota / private mode — in-memory cache still works for the session.
  }
}

export async function loadMeta(): Promise<LedgerMeta | null> {
  try {
    return await idbGet<LedgerMeta>(META_KEY);
  } catch {
    return null;
  }
}

export async function saveMeta(meta: LedgerMeta): Promise<void> {
  try {
    await idbSet(META_KEY, meta);
  } catch {
    /* ignore */
  }
}

export async function clearPersisted(): Promise<void> {
  try {
    await Promise.all([idbDel(SNAPSHOT_KEY), idbDel(META_KEY)]);
  } catch {
    /* ignore */
  }
}

/** Silent full resync interval (heal drift without every-load megabyte pulls). */
export const FULL_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
