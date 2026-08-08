import { useMemo, useState, type CSSProperties } from 'react';
import { CategorizeModal } from '../components/CategorizeModal';
import { CategoryChip } from '../components/CategoryChip';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import { formatMoney, moneyClass } from '../lib/money';
import { ledgerApi } from '../api/client';
import {
  categoryChipForTxn,
  groupInboxByCategory,
} from '../lib/categoryDisplay';
import {
  formatClearedLabel,
  isInboxTxn,
  patchTransactionApproved,
  patchTransactionFields,
  resolvePayee,
} from '../lib/dataStore';
import type { Transaction } from '../api/types';

export function InboxPage() {
  const { data, loading, error, refresh } = useLedger();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categorizeIds, setCategorizeIds] = useState<string[] | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const items = useMemo(() => {
    if (!data) return [];
    return data.transactions
      .filter((t) => isInboxTxn(t, data))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [data]);

  const categoryGroups = useMemo(() => {
    if (!data) return [];
    return groupInboxByCategory(data, items);
  }, [data, items]);

  // Drop selections that left the inbox.
  const liveIds = useMemo(() => new Set(items.map((t) => t.ynabId)), [items]);
  const selectedLive = useMemo(() => {
    const next = new Set<string>();
    for (const id of selected) {
      if (liveIds.has(id)) next.add(id);
    }
    return next;
  }, [selected, liveIds]);

  const selectedTxns = useMemo(
    () => items.filter((t) => selectedLive.has(t.ynabId)),
    [items, selectedLive],
  );
  const selectedNet = useMemo(
    () => selectedTxns.reduce((s, t) => s + t.amount, 0),
    [selectedTxns],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(items.map((t) => t.ynabId)));
  }

  function selectGroup(ids: string[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));
      if (allSelected) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function approveSelected() {
    if (selectedTxns.length === 0 || busy) return;
    const ids = selectedTxns.map((t) => t.ynabId);
    // Local remove first — stay on this list, no full ledger refresh.
    patchTransactionApproved(ids);
    clearSelection();
    setBanner(`Approved ${ids.length}`);
    void (async () => {
      try {
        for (const id of ids) {
          await ledgerApi.approve(id, true);
        }
      } catch (e) {
        setBanner(
          e instanceof Error
            ? `Approve save failed: ${e.message}`
            : `Approve save failed: ${String(e)}`,
        );
      }
    })();
  }

  if (loading && !data) return <Loading />;
  if (error && !data)
    return <ErrorPanel message={error} onRetry={() => void refresh()} />;
  if (!data) return <Loading />;

  const hasSelection = selectedLive.size > 0;
  const categorizeTxns =
    categorizeIds &&
    categorizeIds
      .map((id) => data.transactions.find((t) => t.ynabId === id))
      .filter((t): t is Transaction => !!t);

  const detailTxn = detailId
    ? data.transactions.find((t) => t.ynabId === detailId) || null
    : null;

  return (
    <div className={`page inbox-page ${hasSelection ? 'has-selection' : ''}`}>
      <header className="page-header">
        <div>
          <h1>
            {hasSelection
              ? `${selectedLive.size} selected`
              : items.length > 0
                ? `Categorization (${items.length})`
                : 'Categorization'}
          </h1>
          <p className="muted">
            {hasSelection ? (
              <>
                Net total{' '}
                <span className={`mono ${moneyClass(selectedNet)}`}>
                  {formatMoney(selectedNet, data.plan.currency || 'USD', {
                    sign: true,
                  })}
                </span>
              </>
            ) : (
              <>
                Grouped by category · approve works without a category
              </>
            )}
          </p>
          {banner && <p className="muted small">{banner}</p>}
        </div>
        <div className="btn-row">
          {hasSelection ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={clearSelection}
            >
              Clear selection
            </button>
          ) : (
            items.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={selectAll}
              >
                Select all
              </button>
            )
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="panel empty">
          <h2>All clear ✨</h2>
          <p className="muted">
            No transactions need categorization or approval.
          </p>
        </div>
      ) : (
        <div className="panel inbox-panel">
          {categoryGroups.map((group) => {
            const groupIds = group.transactions.map((t) => t.ynabId);
            const selectedInGroup = groupIds.filter((id) =>
              selectedLive.has(id),
            ).length;
            const allGroupSelected =
              groupIds.length > 0 && selectedInGroup === groupIds.length;
            return (
              <section key={group.key} className="inbox-cat-group">
                <header className="inbox-cat-header">
                  <span
                    className="inbox-cat-swatch"
                    style={{ background: group.railColor }}
                    aria-hidden
                  />
                  <CategoryChip chip={group.chip} />
                  <span className="muted small">
                    {group.transactions.length}
                    {selectedInGroup > 0 && selectedInGroup < groupIds.length
                      ? ` · ${selectedInGroup} selected`
                      : ''}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm inbox-cat-select"
                    onClick={() => selectGroup(groupIds)}
                  >
                    {allGroupSelected ? 'Deselect' : 'Select'}
                  </button>
                </header>
                <ul className="inbox-list inbox-list--railed">
                  {group.transactions.map((t, idx) => {
                    const acct = data.accounts.find(
                      (a) => a.ynabId === t.accountId,
                    );
                    const isSel = selectedLive.has(t.ynabId);
                    const isFirst = idx === 0;
                    const isLast = idx === group.transactions.length - 1;
                    return (
                      <li
                        key={t.ynabId}
                        className={[
                          'inbox-row',
                          'inbox-row--railed',
                          isSel ? 'is-selected' : '',
                          isFirst ? 'is-group-first' : '',
                          isLast ? 'is-group-last' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={
                          {
                            '--rail-color': group.railColor,
                          } as CSSProperties
                        }
                      >
                        <span className="inbox-rail" aria-hidden />
                        <label className="inbox-check">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggle(t.ynabId)}
                          />
                        </label>
                        <button
                          type="button"
                          className="inbox-main-btn"
                          onClick={() => setDetailId(t.ynabId)}
                        >
                          <div className="inbox-main">
                            <div className="row-title">
                              {resolvePayee(data, t.payeeId)}
                            </div>
                            <div className="inbox-meta">
                              <span className="muted small">
                                {t.date} · {acct?.name || 'Account'} ·{' '}
                                {formatClearedLabel(t.cleared, t.approved)}
                              </span>
                            </div>
                            {t.memo && (
                              <div className="muted small">{t.memo}</div>
                            )}
                          </div>
                          <div className={`mono ${moneyClass(t.amount)}`}>
                            {formatMoney(
                              t.amount,
                              data.plan.currency || 'USD',
                              { sign: true },
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {hasSelection && (
        <div className="inbox-action-bar" role="toolbar">
          <div className="inbox-action-meta">
            <strong>{selectedLive.size} selected</strong>
            <span className={`mono ${moneyClass(selectedNet)}`}>
              {formatMoney(selectedNet, data.plan.currency || 'USD', {
                sign: true,
              })}
            </span>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => void approveSelected()}
            >
              Approve
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                busy || selectedTxns.every((t) => !!t.transferAccountId)
              }
              onClick={() =>
                setCategorizeIds(
                  selectedTxns
                    .filter((t) => !t.transferAccountId)
                    .map((t) => t.ynabId),
                )
              }
            >
              Categorize
            </button>
          </div>
        </div>
      )}

      {categorizeTxns && categorizeTxns.length > 0 && (
        <CategorizeModal
          data={data}
          transactions={categorizeTxns}
          onClose={() => setCategorizeIds(null)}
          onDone={() => {
            // Local cache already dropped rows; stay on this page — no refresh().
            clearSelection();
            setBanner(
              categorizeTxns.length > 1
                ? `Categorized ${categorizeTxns.length}`
                : null,
            );
          }}
          onBackgroundError={(message) => setBanner(message)}
        />
      )}

      {detailTxn && (
        <TxnDetailModal
          data={data}
          txn={detailTxn}
          busy={busy}
          setBusy={setBusy}
          onClose={() => setDetailId(null)}
          onBanner={setBanner}
          onCategorize={() => {
            setDetailId(null);
            setCategorizeIds([detailTxn.ynabId]);
          }}
        />
      )}
    </div>
  );
}

function TxnDetailModal({
  data,
  txn,
  busy,
  setBusy,
  onClose,
  onBanner,
  onCategorize,
}: {
  data: NonNullable<ReturnType<typeof useLedger>['data']>;
  txn: Transaction;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onClose: () => void;
  onBanner: (msg: string | null) => void;
  onCategorize: () => void;
}) {
  const [payee, setPayee] = useState(resolvePayee(data, txn.payeeId));
  const [amount, setAmount] = useState((txn.amount / 1000).toFixed(2));
  const [memo, setMemo] = useState(txn.memo || '');
  const [err, setErr] = useState<string | null>(null);
  const acct = data.accounts.find((a) => a.ynabId === txn.accountId);

  async function save(alsoApprove = false) {
    const n = Number(amount.replace(/[$,\s]/g, ''));
    if (Number.isNaN(n)) {
      setErr('Enter a valid amount');
      return;
    }
    const milli = Math.round(n * 1000);
    setBusy(true);
    setErr(null);
    try {
      await ledgerApi.devicePush({
        transactions: [
          {
            ynabId: txn.ynabId,
            clientId: txn.ynabId,
            accountId: txn.accountId,
            date: txn.date,
            amount: milli,
            payeeId: txn.payeeId,
            categoryId: txn.categoryId,
            memo: memo.trim() || null,
            cleared: txn.cleared,
            approved: alsoApprove ? true : txn.approved,
            payeeName: payee.trim() || undefined,
          },
        ],
      });
      patchTransactionFields(txn.ynabId, {
        amount: milli,
        memo: memo.trim() || null,
        approved: alsoApprove ? true : txn.approved,
      });
      onBanner(alsoApprove ? 'Saved + approved' : 'Saved');
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
            <h2>Transaction</h2>
            <p className="muted">
              {acct?.name || 'Account'} · {txn.date} ·{' '}
              {formatClearedLabel(txn.cleared, txn.approved)}
            </p>
            <p className="muted small inbox-meta">
              Category:{' '}
              <CategoryChip chip={categoryChipForTxn(data, txn)} />
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="form-stack">
          <label>
            <span className="muted small">Payee</span>
            <input
              className="input"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            <span className="muted small">Amount (negative = outflow)</span>
            <input
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            <span className="muted small">Memo</span>
            <input
              className="input"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>
        {err && <div className="alert alert-error">{err}</div>}
        <div className="btn-row" style={{ marginTop: 14 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void save(false)}
          >
            Save
          </button>
          {!txn.transferAccountId && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={onCategorize}
            >
              Categorize
            </button>
          )}
          {!txn.approved && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => void save(true)}
            >
              Approve
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
