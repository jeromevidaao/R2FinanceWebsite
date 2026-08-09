import { useMemo, useState, type ReactNode } from 'react';
import type { Category, CategoryGroup, Transaction } from '../api/types';
import { CategoryChip } from './CategoryChip';
import { categoryChipForCategory, categoryChipForTxn } from '../lib/categoryDisplay';
import { formatMoney } from '../lib/money';
import { formatFriendlyDate } from '../lib/relativeDate';
import {
  isAssignableCategory,
  resolveAccountName,
  resolvePayee,
  formatTxnStatus,
} from '../lib/dataStore';
import type { LedgerData } from '../lib/dataStore';
import { mapsLinkForTxn } from '../lib/googleMaps';
import { enqueueCategorize } from '../lib/pendingCategorize';
import { venmoDescriptionLabel } from '../lib/displayPayee';

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
  /** @deprecated Errors surface via UndoCategorizeBar. */
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
   * Super-fast path + 10s undo window:
   * 1. Patch local cache → Categorization list drops rows (no HTTP)
   * 2. Close modal → back on the same list
   * 3. API push after ~10s (UndoCategorizeBar can cancel)
   */
  function pick(catId: string) {
    if (targets.length === 0) return;
    const cat = data.categories.find((c) => c.ynabId === catId);
    const categoryName = cat?.name || 'Category';
    const payeeHint =
      !bulk && primary ? resolvePayee(data, primary) : undefined;
    enqueueCategorize({
      snapshots: targets.map((t) => ({ ...t })),
      categoryId: catId,
      categoryName,
      payeeHint,
    });
    onDone?.();
    onClose();
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
                  ? (() => {
                      const acct = data.accounts.find(
                        (a) => a.ynabId === primary.accountId,
                      );
                      const desc = venmoDescriptionLabel({
                        plaidDescription: primary.plaidDescription,
                        plaidName: primary.plaidName,
                        plaidMerchantName: primary.plaidMerchantName,
                      });
                      const dateSlash = String(primary.date || '')
                        .trim()
                        .replace(/-/g, '/');
                      // Ruby BoA · 2026/06/16 · Needs approval - Person - note
                      if (desc) {
                        return `${resolveAccountName(acct)} · ${dateSlash} · ${formatTxnStatus(primary.approved !== false)} - ${desc}`;
                      }
                      return `${resolvePayee(data, primary)} · ${formatFriendlyDate(primary.date)} · ${formatMoney(primary.amount)}`;
                    })()
                  : ''}
            </p>
            {!bulk &&
              primary &&
              (() => {
                const payee = resolvePayee(data, primary);
                const maps = mapsLinkForTxn(primary, payee);
                const loc = primary.locationDisplay;
                const pfc = primary.plaidPfc;
                if (!loc && !pfc && !maps) return null;
                const bits: ReactNode[] = [];
                if (loc) bits.push(`📍 ${loc}`);
                if (pfc) bits.push(pfc);
                if (maps) {
                  bits.push(
                    <a
                      key="maps"
                      className="maps-link"
                      href={maps}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Google Maps
                    </a>,
                  );
                }
                return (
                  <p
                    className="muted small inbox-meta"
                    title={primary.location?.text || undefined}
                  >
                    {bits.map((b, i) => (
                      <span key={i}>
                        {i > 0 ? ' · ' : null}
                        {b}
                      </span>
                    ))}
                  </p>
                );
              })()}
            {bulk &&
              (() => {
                const withPlace = targets.filter(
                  (t) => t.locationDisplay || mapsLinkForTxn(t, resolvePayee(data, t)),
                );
                if (!withPlace.length) return null;
                const shown = withPlace.slice(0, 3);
                return (
                  <p className="muted small inbox-meta">
                    {shown.map((t, i) => {
                      const payee = resolvePayee(data, t);
                      const maps = mapsLinkForTxn(t, payee);
                      const label = t.locationDisplay
                        ? `📍 ${t.locationDisplay}`
                        : `📍 ${payee}`;
                      return (
                        <span key={t.ynabId}>
                          {i > 0 ? ' · ' : null}
                          {maps ? (
                            <a
                              className="maps-link"
                              href={maps}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title="Open place on Google Maps"
                            >
                              {label}
                            </a>
                          ) : (
                            label
                          )}
                        </span>
                      );
                    })}
                    {withPlace.length > 3
                      ? ` +${withPlace.length - 3} more`
                      : null}
                  </p>
                );
              })()}
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
          Tap a category to return to the list. You have about 10 seconds to
          Undo before it saves to R2Finance and YNAB
          {bulk ? ' — same category for every selected transaction' : ''}.
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
