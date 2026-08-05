import { useCallback, useEffect, useState } from 'react';
import {
  getCache,
  loadLedger,
  subscribe,
  type LedgerData,
} from '../lib/dataStore';

export function useLedger() {
  const [data, setData] = useState<LedgerData | null>(getCache());
  const [loading, setLoading] = useState(!getCache());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (force = true) => {
    setLoading(true);
    setError(null);
    try {
      const d = await loadLedger(force);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = subscribe(() => setData(getCache()));
    if (!getCache()) {
      void refresh(true);
    } else {
      setLoading(false);
    }
    return unsub;
  }, [refresh]);

  return { data, loading, error, refresh };
}
