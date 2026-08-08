import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CategorizeModal } from '../components/CategorizeModal';
import { CategoryChip } from '../components/CategoryChip';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import { categoryChipForTxn } from '../lib/categoryDisplay';
import { formatMoney, moneyClass } from '../lib/money';
import {
  formatTxnStatus,
  resolveAccountName,
  resolveCategory,
  resolvePayee,
  txnStatusPillMod,
  type LedgerData,
} from '../lib/dataStore';
import type { Transaction } from '../api/types';

export function RegisterPage() {
  const { accountId = '' } = useParams();
  const { data, loading, error, refresh } = useLedger();
  const [q, setQ] = useState('');
  /** Status filter = YNAB `approved` (not bank cleared). */
  const [approvalFilter, setApprovalFilter] = useState<
    'all' | 'approved' | 'needs-approval'
  >('all');
  const [target, setTarget] = useState<Transaction | null>(null);

  const account = data?.accounts.find((a) => a.ynabId === accountId);

  const rows = useMemo(() => {
    if (!data) return [];
    let list = data.transactions.filter((t) => t.accountId === accountId);
    if (approvalFilter === 'approved')
      list = list.filter((t) => t.approved !== false);
    if (approvalFilter === 'needs-approval')
      list = list.filter((t) => t.approved === false);
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((t) => {
        const payee = resolvePayee(data, t).toLowerCase();
        const cat = resolveCategory(data, t.categoryId, t).toLowerCase();
        const memo = (t.memo || '').toLowerCase();
        return (
          payee.includes(needle) ||
          cat.includes(needle) ||
          memo.includes(needle) ||
          t.date.includes(needle)
        );
      });
    }
    return list;
  }, [data, accountId, q, approvalFilter]);

  if (loading && !data) return <Loading />;
  if (error && !data)
    return <ErrorPanel message={error} onRetry={() => void refresh()} />;
  if (!data) return <Loading />;
  if (!account) {
    return (
      <div className="page">
        <ErrorPanel message="Account not found" />
        <Link to="/accounts">Back to accounts</Link>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <Link to="/accounts" className="back-link">
            ← Accounts
          </Link>
          <h1>{resolveAccountName(account)}</h1>
          {account.alias?.trim() && account.alias.trim() !== account.name ? (
            <p className="muted small">YNAB: {account.name}</p>
          ) : null}
          <p className={`stat-value ${moneyClass(account.balance)}`}>
            {formatMoney(account.balance)}
          </p>
        </div>
      </header>

      <div className="toolbar">
        <input
          className="input search"
          placeholder="Search register…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input"
          value={approvalFilter}
          onChange={(e) =>
            setApprovalFilter(e.target.value as typeof approvalFilter)
          }
        >
          <option value="all">All statuses</option>
          <option value="approved">Approved</option>
          <option value="needs-approval">Needs approval</option>
        </select>
      </div>

      <TxnTable data={data} rows={rows} onCategorize={setTarget} />

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

export function TxnTable({
  data,
  rows,
  onCategorize,
  showAccount,
  showMemo = true,
  footNote,
}: {
  data: LedgerData;
  rows: Transaction[];
  onCategorize?: (t: Transaction) => void;
  showAccount?: boolean;
  /** When false, hide the Memo column (e.g. all-transactions page). */
  showMemo?: boolean;
  /** Override default footer text (e.g. pagination range). */
  footNote?: string;
}) {
  const tableClass = [
    'txn-table',
    showAccount ? 'txn-table--with-account' : '',
    onCategorize ? 'txn-table--with-actions' : '',
    showMemo ? '' : 'txn-table--no-memo',
  ]
    .filter(Boolean)
    .join(' ');

  const colCount =
    5 + // date, payee, category, status, amount
    (showAccount ? 1 : 0) +
    (showMemo ? 1 : 0) +
    (onCategorize ? 1 : 0);

  return (
    <div className="table-wrap panel">
      <table className={tableClass}>
        <colgroup>
          <col className="txn-col-date" />
          {showAccount && <col className="txn-col-account" />}
          <col className="txn-col-payee" />
          <col className="txn-col-category" />
          {showMemo && <col className="txn-col-memo" />}
          <col className="txn-col-status" />
          <col className="txn-col-amount" />
          {onCategorize && <col className="txn-col-actions" />}
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {showAccount && <th scope="col">Account</th>}
            <th scope="col">Payee</th>
            <th scope="col">Category</th>
            {showMemo && <th scope="col">Memo</th>}
            <th scope="col">Status</th>
            <th scope="col" className="num">
              Amount
            </th>
            {onCategorize && (
              <th scope="col" className="txn-actions-col">
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={colCount} className="muted">
                No transactions
              </td>
            </tr>
          )}
          {rows.map((t) => {
            const acct = data.accounts.find((a) => a.ynabId === t.accountId);
            const payee = resolvePayee(data, t);
            const memo = t.memo || '';
            const canEditCategory = !!onCategorize && !t.transferAccountId;
            const chip = categoryChipForTxn(data, t);
            return (
              <tr key={t.ynabId}>
                <td className="mono txn-cell-fixed">{t.date}</td>
                {showAccount && (
                  <td className="txn-cell-clip" title={acct?.name || undefined}>
                    <Link to={`/accounts/${t.accountId}`}>
                      {acct?.name || '—'}
                    </Link>
                  </td>
                )}
                <td className="txn-cell-clip" title={payee || undefined}>
                  {payee}
                </td>
                <td
                  className={
                    !t.categoryId && !t.transferAccountId
                      ? 'warn txn-cell-category'
                      : 'txn-cell-category'
                  }
                >
                  {canEditCategory ? (
                    <button
                      type="button"
                      className="txn-cat-btn"
                      title={
                        t.categoryId
                          ? `${chip.label} — change category (saves to cloud + YNAB)`
                          : 'Set category (saves to cloud + YNAB)'
                      }
                      onClick={() => onCategorize?.(t)}
                    >
                      <CategoryChip chip={chip} />
                      <span className="txn-cat-edit muted small">
                        {t.categoryId ? 'Change' : 'Set'}
                      </span>
                    </button>
                  ) : (
                    <CategoryChip chip={chip} />
                  )}
                </td>
                {showMemo && (
                  <td className="muted txn-cell-clip" title={memo || undefined}>
                    {memo}
                  </td>
                )}
                <td className="txn-cell-fixed">
                  <span
                    className={`pill pill-${txnStatusPillMod(t.approved !== false)}`}
                    title={
                      t.approved !== false
                        ? 'Approved in R2Finance / YNAB'
                        : 'Not approved yet — still in Categorization'
                    }
                  >
                    {formatTxnStatus(t.approved !== false)}
                  </span>
                </td>
                <td className={`num mono txn-cell-fixed ${moneyClass(t.amount)}`}>
                  {formatMoney(t.amount, data.plan.currency || 'USD', {
                    sign: true,
                  })}
                </td>
                {onCategorize && (
                  <td className="txn-actions-col">
                    {canEditCategory ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onCategorize(t)}
                      >
                        {t.categoryId ? 'Edit category' : 'Categorize'}
                      </button>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="table-foot muted small">
        {footNote ??
          `${rows.length.toLocaleString()} transactions${
            onCategorize
              ? ' · click a category to change it (syncs to cloud + YNAB)'
              : ''
          }`}
      </div>
    </div>
  );
}
