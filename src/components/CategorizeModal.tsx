import { useMemo, useState } from 'react';
import { ledgerApi } from '../api/client';
import type { Category, CategoryGroup, Transaction } from '../api/types';
import { formatMoney } from '../lib/money';
import {
  isAssignableCategory,
  patchTransactionCategory,
  resolveCategory,
  resolvePayee,
} from '../lib/dataStore';
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
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const currentLabel = resolveCategory(data, txn.categoryId, txn);
  const isRecat = !!txn.categoryId && !txn.transferAccountId;

  const groups = useMemo(() => {
    const byGroup = new Map<string, { group: CategoryGroup; cats: Category[] }>();
    for (const g of data.groups.filter((g) => !g.hidden)) {
      if (!isAssignableCategory(g.name, '')) continue;
      byGroup.set(g.ynabId, { group: g, cats: [] });
    }
    for (const c of data.categories.filter((c) => !c.hidden)) {
      const group = data.groups.find((g) => g.ynabId === c.categoryGroupId);
      if (!isAssignableCategory(group?.name, c.name)) continue;
      const key = c.categoryGroupId || '_ungrouped';
      if (!byGroup.has(key)) {
        byGroup.set(key, {
          group: {
            ynabId: key,
            name: group?.name || 'Other',
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
      .filter((x) => x.cats.length > 0)
      .sort((a, b) => a.group.name.localeCompare(b.group.name));
  }, [data, q]);

  async function pick(catId: string) {
    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      const result = await ledgerApi.categorize(txn.ynabId, catId, true);
      patchTransactionCategory(txn.ynabId, catId);
      const pushed = result.push?.pushed ?? 0;
      const failed = result.push?.failed ?? 0;
      const catName =
        data.categories.find((c) => c.ynabId === catId)?.name || 'category';
      if (failed > 0) {
        setOkMsg(`Saved in R2Finance; YNAB push reported failures`);
      } else if (pushed > 0) {
        setOkMsg(`Set to ${catName} · synced to YNAB`);
      } else {
        setOkMsg(`Set to ${catName}`);
      }
      onDone?.();
      // Brief success then close
      window.setTimeout(() => onClose(), 450);
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
            <h2>{isRecat ? 'Change category' : 'Categorize'}</h2>
            <p className="muted">
              {resolvePayee(data, txn.payeeId)} · {txn.date} ·{' '}
              {formatMoney(txn.amount)}
            </p>
            {isRecat && (
              <p className="muted small">Current: {currentLabel}</p>
            )}
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
        {okMsg && <div className="alert alert-ok">{okMsg}</div>}
        <div className="modal-body cat-picker">
          {groups.length === 0 && (
            <p className="muted">No matching categories.</p>
          )}
          {groups.map(({ group, cats }) => (
            <section key={group.ynabId}>
              <h3 className="group-title">{group.name}</h3>
              <ul className="pick-list">
                {cats.map((c) => (
                  <li key={c.ynabId}>
                    <button
                      type="button"
                      disabled={busy}
                      className={
                        c.ynabId === txn.categoryId ? 'is-current' : undefined
                      }
                      onClick={() => void pick(c.ynabId)}
                    >
                      {c.name}
                      {c.ynabId === txn.categoryId ? ' · current' : ''}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="muted small">
          Writes to R2Finance DynamoDB and immediately pushes the category to
          YNAB. Categories set in YNAB sync back on the next pull (≤15 min).
        </p>
      </div>
    </div>
  );
}
