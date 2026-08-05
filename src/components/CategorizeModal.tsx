import { useMemo, useState } from 'react';
import { ledgerApi } from '../api/client';
import type { Category, CategoryGroup, Transaction } from '../api/types';
import { formatMoney } from '../lib/money';
import { patchTransactionCategory, resolvePayee } from '../lib/dataStore';
import type { LedgerData } from '../lib/dataStore';

export function CategorizeModal({
  data,
  txn,
  onClose,
  onDone,
}: {
  data: LedgerData;
  txn: Transaction;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const groups = useMemo(() => {
    const byGroup = new Map<string, { group: CategoryGroup; cats: Category[] }>();
    for (const g of data.groups.filter((g) => !g.hidden)) {
      byGroup.set(g.ynabId, { group: g, cats: [] });
    }
    for (const c of data.categories.filter((c) => !c.hidden)) {
      const key = c.categoryGroupId || '_ungrouped';
      if (!byGroup.has(key)) {
        byGroup.set(key, {
          group: {
            ynabId: key,
            name: 'Other',
            hidden: false,
          },
          cats: [],
        });
      }
      byGroup.get(key)!.cats.push(c);
    }
    const needle = q.trim().toLowerCase();
    return [...byGroup.values()]
      .map(({ group, cats }) => ({
        group,
        cats: needle
          ? cats.filter(
              (c) =>
                c.name.toLowerCase().includes(needle) ||
                group.name.toLowerCase().includes(needle),
            )
          : cats,
      }))
      .filter((x) => x.cats.length > 0);
  }, [data, q]);

  async function pick(catId: string) {
    setBusy(true);
    setErr(null);
    try {
      await ledgerApi.categorize(txn.ynabId, catId, true);
      patchTransactionCategory(txn.ynabId, catId);
      onDone?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>Categorize</h2>
            <p className="muted">
              {resolvePayee(data, txn.payeeId)} · {txn.date} ·{' '}
              {formatMoney(txn.amount)}
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <input
          className="input"
          placeholder="Search categories…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        {err && <div className="alert alert-error">{err}</div>}
        <div className="modal-body cat-picker">
          {groups.map(({ group, cats }) => (
            <section key={group.ynabId}>
              <h3 className="group-title">{group.name}</h3>
              <ul className="pick-list">
                {cats.map((c) => (
                  <li key={c.ynabId}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void pick(c.ynabId)}
                    >
                      {c.name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
