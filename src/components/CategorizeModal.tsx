import { useMemo, useState } from 'react';
import { ledgerApi } from '../api/client';
import type { Category, CategoryGroup, Transaction } from '../api/types';
import { formatMoney } from '../lib/money';
import {
  isAssignableCategory,
  patchTransactionCategory,
  patchTransactionCategoryMany,
  resolveCategory,
  resolvePayee,
} from '../lib/dataStore';
import type { LedgerData } from '../lib/dataStore';

export function CategorizeModal({
  data,
  transactions,
  txn: singleTxn,
  onClose,
  onDone,
}: {
  data: LedgerData;
  /** One or many transactions (bulk applies the same category). */
  transactions?: Transaction[];
  /** Back-compat single transaction. */
  txn?: Transaction;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const list = transactions?.length
    ? transactions
    : singleTxn
      ? [singleTxn]
      : [];
  const targets = list.filter((t) => !t.transferAccountId);
  const bulk = targets.length > 1;
  const primary = targets[0];
  const currentLabel = primary
    ? resolveCategory(data, primary.categoryId, primary)
    : '';
  const isRecat = !!primary?.categoryId && !bulk;
  const net = targets.reduce((s, t) => s + t.amount, 0);

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
    if (targets.length === 0) return;
    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      let pushed = 0;
      let failed = 0;
      // Sequential so YNAB push stays small per call.
      for (const t of targets) {
        const result = await ledgerApi.categorize(t.ynabId, catId, true);
        pushed += result.push?.pushed ?? 0;
        failed += result.push?.failed ?? 0;
      }
      const ids = targets.map((t) => t.ynabId);
      if (ids.length === 1) {
        patchTransactionCategory(ids[0], catId);
      } else {
        patchTransactionCategoryMany(ids, catId);
      }
      const catName =
        data.categories.find((c) => c.ynabId === catId)?.name || 'category';
      if (failed > 0) {
        setOkMsg(
          bulk
            ? `Saved ${ids.length} in R2Finance; some YNAB pushes failed`
            : `Saved in R2Finance; YNAB push reported failures`,
        );
      } else if (pushed > 0) {
        setOkMsg(
          bulk
            ? `Set ${ids.length} to ${catName} · synced to YNAB`
            : `Set to ${catName} · synced to YNAB`,
        );
      } else {
        setOkMsg(bulk ? `Set ${ids.length} to ${catName}` : `Set to ${catName}`);
      }
      onDone?.();
      window.setTimeout(() => onClose(), 450);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (targets.length === 0) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <header className="modal-head">
            <h2>Categorize</h2>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </header>
          <p className="muted">
            Transfers cannot be categorized here. Deselect transfer rows and
            try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>
              {bulk
                ? `Categorize ${targets.length} transactions`
                : isRecat
                  ? 'Change category'
                  : 'Categorize'}
            </h2>
            <p className="muted">
              {bulk
                ? `${targets.length} selected · net ${formatMoney(net)}`
                : primary
                  ? `${resolvePayee(data, primary.payeeId)} · ${primary.date} · ${formatMoney(primary.amount)}`
                  : ''}
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
                        !bulk && primary && c.ynabId === primary.categoryId
                          ? 'is-current'
                          : undefined
                      }
                      onClick={() => void pick(c.ynabId)}
                    >
                      {c.name}
                      {!bulk && primary && c.ynabId === primary.categoryId
                        ? ' · current'
                        : ''}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="muted small">
          Writes to R2Finance DynamoDB and pushes the category to YNAB. Applies
          the same category to every selected transaction.
        </p>
      </div>
    </div>
  );
}

/** Back-compat single-txn entry (other pages). */
export function CategorizeModalSingle({
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
  return (
    <CategorizeModal
      data={data}
      transactions={[txn]}
      onClose={onClose}
      onDone={onDone}
    />
  );
}
