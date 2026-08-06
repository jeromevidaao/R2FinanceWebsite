import { useMemo, useState } from 'react';
import { CategorizeModal } from '../components/CategorizeModal';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import { formatMoney, moneyClass } from '../lib/money';
import { ledgerApi } from '../api/client';
import {
  displayCategoryLabel,
  formatClearedLabel,
  isInboxTxn,
  patchTransactionApproved,
  patchTransactionFields,
  resolvePayee,
} from '../lib/dataStore';
import type { Transaction } from '../api/types';

function formatDayHeading(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

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

  const byDate = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of items) {
      const list = map.get(t.date) || [];
      list.push(t);
      map.set(t.date, list);
    }
    return [...map.entries()];
  }, [items]);

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

  function clearSelection() {
    setSelected(new Set());
  }

  async function approveSelected() {
    if (selectedTxns.length === 0 || busy) return;
    setBusy(true);
    setBanner(null);
    try {
      const ids = selectedTxns.map((t) => t.ynabId);
      for (const id of ids) {
        await ledgerApi.approve(id, true);
      }
      patchTransactionApproved(ids);
      clearSelection();
      setBanner(`Approved ${ids.length}`);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
                ? `Spending (${items.length})`
                : 'Spending'}
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
              <>Categorize spending · unapproved or uncategorized</>
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
          {byDate.map(([date, rows]) => (
            <section key={date} className="inbox-day">
              <h2 className="inbox-day-title">{formatDayHeading(date)}</h2>
              <ul className="inbox-list">
                {rows.map((t) => {
                  const acct = data.accounts.find(
                    (a) => a.ynabId === t.accountId,
                  );
                  const isSel = selectedLive.has(t.ynabId);
                  return (
                    <li
                      key={t.ynabId}
                      className={`inbox-row ${isSel ? 'is-selected' : ''}`}
                    >
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
                          <div className="muted small">
                            {displayCategoryLabel(data, t)} ·{' '}
                            {acct?.name || 'Account'} ·{' '}
                            {formatClearedLabel(t.cleared, t.approved)}
                          </div>
                          {t.memo && (
                            <div className="muted small">{t.memo}</div>
                          )}
                        </div>
                        <div className={`mono ${moneyClass(t.amount)}`}>
                          {formatMoney(t.amount, data.plan.currency || 'USD', {
                            sign: true,
                          })}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
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
                busy ||
                selectedTxns.every((t) => !!t.transferAccountId)
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
            clearSelection();
            setBanner(
              categorizeTxns.length > 1
                ? `Categorized ${categorizeTxns.length}`
                : 'Categorized',
            );
          }}
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
            <p className="muted small">
              Category: {displayCategoryLabel(data, txn)}
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
