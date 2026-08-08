import { useEffect, useMemo, useState } from 'react';
import { CategorizeModal } from '../components/CategorizeModal';
import { ErrorPanel, Loading } from '../components/Loading';
import { TxnTable } from './RegisterPage';
import { useLedger } from '../hooks/useLedger';
import {
  resolveAccountName,
  resolveCategory,
  resolvePayee,
} from '../lib/dataStore';
import type { Transaction } from '../api/types';

const PAGE_SIZE_OPTIONS = [200, 500, 1000] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
const DEFAULT_PAGE_SIZE: PageSize = 200;

export function TransactionsPage() {
  const { data, loading, error, refresh } = useLedger();
  const [q, setQ] = useState('');
  const [accountId, setAccountId] = useState('');
  const [month, setMonth] = useState('');
  const [uncatOnly, setUncatOnly] = useState(false);
  const [target, setTarget] = useState<Transaction | null>(null);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  const months = useMemo(() => {
    if (!data) return [];
    const set = new Set(data.transactions.map((t) => t.date.slice(0, 7)));
    return [...set].sort().reverse();
  }, [data]);

  /** Full filtered list (before pagination). */
  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.transactions;
    if (accountId) list = list.filter((t) => t.accountId === accountId);
    if (month) list = list.filter((t) => t.date.startsWith(month));
    if (uncatOnly)
      list = list.filter((t) => !t.categoryId && !t.transferAccountId);
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((t) => {
        const payee = resolvePayee(data, t).toLowerCase();
        const cat = resolveCategory(data, t.categoryId, t).toLowerCase();
        const acctObj = data.accounts.find((a) => a.ynabId === t.accountId);
        const acct = resolveAccountName(acctObj).toLowerCase();
        const acctYnab = (acctObj?.name || '').toLowerCase();
        const acctAlias = (acctObj?.alias || '').toLowerCase();
        const mask = (acctObj?.mask || '').toLowerCase();
        return (
          payee.includes(needle) ||
          cat.includes(needle) ||
          acct.includes(needle) ||
          acctYnab.includes(needle) ||
          acctAlias.includes(needle) ||
          mask.includes(needle) ||
          t.date.includes(needle)
        );
      });
    }
    return list;
  }, [data, q, accountId, month, uncatOnly]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePage, pageSize]);

  // Reset to first page when filters or page size change.
  useEffect(() => {
    setPage(1);
  }, [q, accountId, month, uncatOnly, pageSize]);

  // Clamp page if the filtered set shrinks (e.g. categorize removes from uncat filter).
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  if (loading && !data) return <Loading />;
  if (error && !data)
    return <ErrorPanel message={error} onRetry={() => void refresh()} />;
  if (!data) return <Loading />;

  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  return (
    <div className="page page--ledger">
      <header className="page-header">
        <div>
          <h1>Transactions</h1>
          <p className="muted">
            {data.transactions.length.toLocaleString()} in ledger
            {total !== data.transactions.length
              ? ` · ${total.toLocaleString()} match filters`
              : ''}
            {' · '}
            change any category to save to R2Finance + YNAB
          </p>
        </div>
      </header>

      <div className="toolbar wrap">
        <input
          className="input search"
          placeholder="Search payee, category, account…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">All accounts</option>
          {data.accounts.map((a) => (
            <option key={a.ynabId} value={a.ynabId}>
              {resolveAccountName(a)}
              {a.mask ? ` · ••••${a.mask}` : ''}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        >
          <option value="">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={uncatOnly}
            onChange={(e) => setUncatOnly(e.target.checked)}
          />
          Uncategorized only
        </label>
        <label className="page-size-label">
          <span className="muted small">Per page</span>
          <select
            className="input page-size-select"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
            aria-label="Rows per page"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      </div>

      <TxnTable
        data={data}
        rows={pageRows}
        showAccount
        showMemo={false}
        onCategorize={setTarget}
        footNote={
          total === 0
            ? 'No matching transactions'
            : `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`
        }
      />

      <TxnPagination
        page={safePage}
        totalPages={totalPages}
        total={total}
        from={from}
        to={to}
        onPage={setPage}
      />

      {target && (
        <CategorizeModal
          data={data}
          txn={target}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}

function TxnPagination({
  page,
  totalPages,
  total,
  from,
  to,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  from: number;
  to: number;
  onPage: (p: number) => void;
}) {
  if (total === 0) return null;

  const windowPages = pageWindow(page, totalPages, 7);

  return (
    <div className="txn-pagination" role="navigation" aria-label="Pagination">
      <span className="muted small txn-pagination-range">
        {from.toLocaleString()}–{to.toLocaleString()} of{' '}
        {total.toLocaleString()}
      </span>
      <div className="txn-pagination-controls">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page <= 1}
          onClick={() => onPage(1)}
          aria-label="First page"
        >
          «
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          ‹ Prev
        </button>
        {windowPages.map((p, i) =>
          p === '…' ? (
            <span key={`e-${i}`} className="muted small txn-pagination-ellipsis">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={
                p === page
                  ? 'btn btn-primary btn-sm'
                  : 'btn btn-secondary btn-sm'
              }
              aria-current={p === page ? 'page' : undefined}
              onClick={() => onPage(p)}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          Next ›
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page >= totalPages}
          onClick={() => onPage(totalPages)}
          aria-label="Last page"
        >
          »
        </button>
      </div>
    </div>
  );
}

/** Compact page list: 1 … 4 5 6 … 20 */
function pageWindow(
  page: number,
  totalPages: number,
  maxButtons: number,
): Array<number | '…'> {
  if (totalPages <= maxButtons) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const half = Math.floor((maxButtons - 3) / 2);
  let start = Math.max(2, page - half);
  let end = Math.min(totalPages - 1, page + half);
  if (page - 1 <= half) {
    start = 2;
    end = maxButtons - 2;
  } else if (totalPages - page <= half) {
    start = totalPages - (maxButtons - 3);
    end = totalPages - 1;
  }
  const out: Array<number | '…'> = [1];
  if (start > 2) out.push('…');
  for (let p = start; p <= end; p++) out.push(p);
  if (end < totalPages - 1) out.push('…');
  out.push(totalPages);
  return out;
}
