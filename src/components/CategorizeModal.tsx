import { useMemo, useState } from 'react';
import { ledgerApi } from '../api/client';
import type { Category, CategoryGroup, Transaction } from '../api/types';
import { CategoryChip } from './CategoryChip';
import { categoryChipForCategory, categoryChipForTxn } from '../lib/categoryDisplay';
import { formatMoney } from '../lib/money';
import { formatFriendlyDate } from '../lib/relativeDate';
import {
  isAssignableCategory,
  patchTransactionCategory,
  patchTransactionCategoryMany,
  resolvePayee,
} from '../lib/dataStore';
import type { LedgerData } from '../lib/dataStore';

export function CategorizeModal({
  data,
  transactions,
  txn: singleTxn,
  onClose,
  onDone,
  onBackgroundError,
}: {
  data: LedgerData;
  /** One or many transactions (bulk applies the same category). */
  transactions?: Transaction[];
  /** Back-compat single transaction. */
  txn?: Transaction;
  onClose: () => void;
  onDone?: () => void;
  /** Optional: surface API failures after optimistic close. */
  onBackgroundError?: (message: string) => void;
}) {
  const [q, setQ] = useState('');

  const list = transactions?.length
    ? transactions
    : singleTxn
      ? [singleTxn]
      : [];
  const targets = list.filter((t) => !t.transferAccountId);
  const bulk = targets.length > 1;
  const primary = targets[0];
  const currentChip = primary ? categoryChipForTxn(data, primary) : null;
  const isRecat =
    !!primary?.categoryId &&
    currentChip?.kind !== 'needed' &&
    !bulk;
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

  /**
   * Super-fast path:
   * 1. Patch local cache → Categorization list drops rows (no HTTP)
   * 2. Close modal → back on the same list
   * 3. Persist + YNAB push in the background (never reloads ledger)
   */
  function pick(catId: string) {
    if (targets.length === 0) return;
    const snapshot = targets.map((t) => ({ ...t }));
    const ids = snapshot.map((t) => t.ynabId);
    // Local remove first — UI returns to the list instantly.
    if (ids.length === 1) {
      patchTransactionCategory(ids[0], catId);
    } else {
      patchTransactionCategoryMany(ids, catId);
    }
    onDone?.();
    onClose();

    void (async () => {
      try {
        // Sequential so YNAB push stays small per call. Do not call loadLedger.
        for (const t of snapshot) {
          await ledgerApi.categorize(t.ynabId, catId, true);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[categorize] background save failed', msg);
        onBackgroundError?.(
          `Category save failed: ${msg}. Pull to refresh if anything looks wrong.`,
        );
      }
    })();
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
                  ? `${resolvePayee(data, primary.payeeId)} · ${formatFriendlyDate(primary.date)} · ${formatMoney(primary.amount)}`
                  : ''}
            </p>
            {isRecat && currentChip && (
              <p className="muted small inbox-meta">
                Current: <CategoryChip chip={currentChip} />
              </p>
            )}
            {!isRecat && currentChip?.kind === 'needed' && (
              <p className="muted small inbox-meta">
                <CategoryChip chip={currentChip} />
              </p>
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
        <div className="modal-body cat-picker">
          {groups.length === 0 && (
            <p className="muted">No matching categories.</p>
          )}
          {groups.map(({ group, cats }) => (
            <section key={group.ynabId}>
              <h3 className="group-title">{group.name}</h3>
              <ul className="pick-list">
                {cats.map((c) => {
                  const chip = categoryChipForCategory(c.name, group.name);
                  const isCurrent =
                    !bulk && primary && c.ynabId === primary.categoryId;
                  return (
                    <li key={c.ynabId}>
                      <button
                        type="button"
                        className={
                          isCurrent ? 'pick-cat-btn is-current' : 'pick-cat-btn'
                        }
                        onClick={() => pick(c.ynabId)}
                      >
                        <CategoryChip chip={chip} />
                        {isCurrent ? (
                          <span className="muted small">current</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <p className="muted small">
          Tap a category to return to the list instantly. Saves in the
          background — same category for every selected transaction.
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
  onBackgroundError,
}: {
  data: LedgerData;
  txn: Transaction;
  onClose: () => void;
  onDone?: () => void;
  onBackgroundError?: (message: string) => void;
}) {
  return (
    <CategorizeModal
      data={data}
      transactions={[txn]}
      onClose={onClose}
      onDone={onDone}
      onBackgroundError={onBackgroundError}
    />
  );
}
