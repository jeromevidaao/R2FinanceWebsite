import { useCallback, useEffect, useState } from 'react';
import {
  getCache,
  loadLedger,
  revalidateLedger,
  subscribe,
  type LedgerData,
} from '../lib/dataStore';

/**
 * Local-first ledger hook.
 * - Paints immediately from memory / IndexedDB when available
 * - Revalidates with a lightweight delta (or silent full if due)
 */
export function useLedger() {
  const [data, setData] = useState<LedgerData | null>(getCache());
  const [loading, setLoading] = useState(!getCache());
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async (forceFull = false) => {
    setError(null);
    // Keep existing UI visible; only show blocking load when empty.
    if (!getCache()) setLoading(true);
    else setSyncing(true);
    try {
      const d = await revalidateLedger(forceFull);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    const unsub = subscribe(() => setData(getCache()));
    let cancelled = false;
    (async () => {
      setError(null);
      if (!getCache()) setLoading(true);
      try {
        // loadLedger hydrates IDB first, then pulls delta/full.
        const d = await loadLedger(false);
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) {
          // If we already have disk/memory data, keep showing it.
          if (!getCache()) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return { data, loading, error, refresh, syncing };
}
