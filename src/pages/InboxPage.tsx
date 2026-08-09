import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { CategorizeModal } from '../components/CategorizeModal';
import { CategoryChip } from '../components/CategoryChip';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import { formatMoney, moneyClass } from '../lib/money';
import { ledgerApi } from '../api/client';
import {
  categoryChipForTxn,
  groupInboxByDate,
} from '../lib/categoryDisplay';
import {
  isInboxTxn,
  patchTransactionApproved,
  patchTransactionFields,
  resolveAccountName,
  resolvePayee,
  formatTxnStatus,
} from '../lib/dataStore';
import type { Transaction } from '../api/types';
import { mapsLinkForTxn } from '../lib/googleMaps';
import { venmoDescriptionLabel } from '../lib/displayPayee';

/** Ledger dates as YYYY/MM/DD only (inbox list + detail). */
function formatInboxDate(raw: string | null | undefined): string {
  if (raw == null || !String(raw).trim()) return '';
  const s = String(raw).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  return s.replace(/-/g, '/');
}

/** e.g. Ruby BoA · 2026/06/16 · Needs approval - Richard Mondor - City bags */
function formatInboxMetaLine(
  account: string,
  date: string,
  approved: boolean,
  txn: Transaction,
): string {
  const base = `${account} · ${formatInboxDate(date)} · ${formatTxnStatus(approved)}`;
  const desc = venmoDescriptionLabel({
    plaidDescription: txn.plaidDescription,
    plaidName: txn.plaidName,
    plaidMerchantName: txn.plaidMerchantName,
  });
  return desc ? `${base} - ${desc}` : base;
}

export function InboxPage() {
  const { data, loading, error, refresh } = useLedger();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categorizeIds, setCategorizeIds] = useState<string[] | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  /** Anchor for Shift+click range select (visual list order). */
  const lastAnchorIdRef = useRef<string | null>(null);

  const items = useMemo(() => {
    if (!data) return [];
    return data.transactions
      .filter((t) => isInboxTxn(t, data))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [data]);

  const dateGroups = useMemo(() => {
    if (!data) return [];
    return groupInboxByDate(data, items);
  }, [data, items]);

  /** Flat ynabIds in on-screen order (date groups top→bottom, rows top→bottom). */
  const orderedIds = useMemo(
    () =>
      dateGroups.flatMap((g) => g.items.map((row) => row.transaction.ynabId)),
    [dateGroups],
  );

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

  function setChecked(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Select every on-screen row between two ids (inclusive). */
  function selectRange(fromId: string, toId: string) {
    const a = orderedIds.indexOf(fromId);
    const b = orderedIds.indexOf(toId);
    if (a < 0 || b < 0) return;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const range = orderedIds.slice(lo, hi + 1);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const rid of range) next.add(rid);
      return next;
    });
  }

  /**
   * Plain checkbox change (click / keyboard). Do not use preventDefault on
   * normal clicks — that broke controlled checkboxes (always-on preventDefault
   * + empty onChange left the box stuck).
   */
  function onCheckboxChange(id: string, checked: boolean) {
    setChecked(id, checked);
    lastAnchorIdRef.current = id;
  }

  /**
   * Shift+click on checkbox: select the visual range from the last anchor.
   * preventDefault only here so onChange does not also flip this one row.
   */
  function onCheckboxClick(
    id: string,
    e: ReactMouseEvent<HTMLInputElement>,
  ) {
    if (!e.shiftKey || !lastAnchorIdRef.current) return;
    e.preventDefault();
    selectRange(lastAnchorIdRef.current, id);
    // Keep the original anchor so repeated Shift+clicks extend from it.
  }

  /** Shift+click on the row body (not checkbox) — same range select. */
  function onRowShiftSelect(id: string, e: ReactMouseEvent) {
    if (!e.shiftKey) return false;
    e.preventDefault();
    if (lastAnchorIdRef.current) {
      selectRange(lastAnchorIdRef.current, id);
    } else {
      setChecked(id, true);
      lastAnchorIdRef.current = id;
    }
    return true;
  }

  function selectAll() {
    setSelected(new Set(items.map((t) => t.ynabId)));
    lastAnchorIdRef.current =
      orderedIds[orderedIds.length - 1] ?? items[0]?.ynabId ?? null;
  }

  function clearSelection() {
    setSelected(new Set());
    lastAnchorIdRef.current = null;
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
                Spreadsheet view · sister pairs merged · Shift+click range ·
                approve works without a category
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
        <div className="table-wrap panel inbox-panel">
          <table className="inbox-table">
            <colgroup>
              <col className="inbox-col-date" />
              <col className="inbox-col-payee" />
              <col className="inbox-col-amount" />
              <col className="inbox-col-account" />
              <col className="inbox-col-category" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="inbox-th-date">
                  Date
                </th>
                <th scope="col">Payee</th>
                <th scope="col" className="num inbox-th-amount">
                  Amount
                </th>
                <th scope="col">Account</th>
                <th scope="col">Category</th>
              </tr>
            </thead>
            <tbody>
              {dateGroups.flatMap((group) =>
                group.items.map((row, idx) => {
                  const t = row.transaction;
                  const acct = data.accounts.find(
                    (a) => a.ynabId === t.accountId,
                  );
                  const isSel = selectedLive.has(t.ynabId);
                  const isFirst = idx === 0;
                  const isLast = idx === group.items.length - 1;
                  const payee = resolvePayee(data, t);
                  const maps = mapsLinkForTxn(t, payee);
                  return (
                    <tr
                      key={t.ynabId}
                      className={[
                        'inbox-tr',
                        isSel ? 'is-selected' : '',
                        isFirst ? 'is-group-first' : '',
                        isLast ? 'is-group-last' : '',
                        row.sisterPair ? 'inbox-tr--sister' : '',
                        row.sisterStart ? 'is-sister-start' : '',
                        row.sisterEnd ? 'is-sister-end' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={
                        {
                          '--rail-color': row.railColor,
                        } as CSSProperties
                      }
                      onClick={(e) => {
                        if (onRowShiftSelect(t.ynabId, e)) return;
                        // Ignore clicks on interactive controls.
                        const el = e.target as HTMLElement;
                        if (
                          el.closest(
                            'input, a, button, label, .inbox-check',
                          )
                        ) {
                          return;
                        }
                        setDetailId(t.ynabId);
                      }}
                    >
                      <td className="inbox-td-date">
                        <div className="inbox-date-cell">
                          <label
                            className="inbox-check"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={isSel}
                              onChange={(e) =>
                                onCheckboxChange(t.ynabId, e.target.checked)
                              }
                              onClick={(e) => onCheckboxClick(t.ynabId, e)}
                              aria-label={
                                isSel
                                  ? `Deselect ${payee}`
                                  : `Select ${payee}`
                              }
                            />
                          </label>
                          <span className="mono inbox-date-text">
                            {formatInboxDate(t.date)}
                          </span>
                        </div>
                      </td>
                      <td
                        className="inbox-td-payee"
                        title={
                          [payee, t.memo, t.locationDisplay]
                            .filter(Boolean)
                            .join(' · ') || undefined
                        }
                      >
                        <span className="inbox-payee-line">
                          {payee}
                          {t.amazonOrderUrl ? (
                            <>
                              {' '}
                              <a
                                className="amazon-order-link"
                                href={t.amazonOrderUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title={
                                  t.amazonOrderNumber
                                    ? `Amazon order ${t.amazonOrderNumber}`
                                    : 'View Amazon order'
                                }
                              >
                                Amazon order
                              </a>
                            </>
                          ) : null}
                          {row.sisterEnd && (
                            <span className="sister-badge muted">
                              {' '}
                              · pair
                            </span>
                          )}
                          {maps ? (
                            <>
                              {' '}
                              <a
                                className="maps-link"
                                href={maps}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title="Open place on Google Maps"
                              >
                                Maps
                              </a>
                            </>
                          ) : null}
                        </span>
                      </td>
                      <td
                        className={`num mono inbox-td-amount ${moneyClass(t.amount)}`}
                      >
                        {formatMoney(
                          t.amount,
                          data.plan.currency || 'USD',
                          { sign: true },
                        )}
                      </td>
                      <td
                        className="inbox-td-account muted"
                        title={resolveAccountName(acct)}
                      >
                        {resolveAccountName(acct)}
                      </td>
                      <td className="inbox-td-category">
                        <CategoryChip chip={row.chip} />
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
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
            // Cloud save waits ~10s (Undo bar); errors surface on UndoCategorizeBar.
            clearSelection();
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
  const [payee, setPayee] = useState(() => {
    const resolved = resolvePayee(data, txn);
    return resolved === '—' ? '' : resolved;
  });
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
              {formatInboxMetaLine(
                resolveAccountName(acct),
                txn.date,
                txn.approved !== false,
                txn,
              )}
            </p>
            {txn.amazonOrderUrl ? (
              <p className="muted small inbox-meta">
                <a
                  className="amazon-order-link"
                  href={txn.amazonOrderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {txn.amazonOrderNumber
                    ? `Amazon order ${txn.amazonOrderNumber}`
                    : 'Amazon order'}
                </a>
                {txn.amazonItemsSummary
                  ? ` · ${txn.amazonItemsSummary}`
                  : null}
              </p>
            ) : null}
            {(() => {
              const maps = mapsLinkForTxn(txn, payee);
              const loc = txn.locationDisplay;
              const pfc = txn.plaidPfc;
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
                  >
                    Google Maps
                  </a>,
                );
              }
              return (
                <p
                  className="muted small inbox-meta"
                  title={txn.location?.text || undefined}
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
