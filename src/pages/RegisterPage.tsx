import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CategorizeModal } from '../components/CategorizeModal';
import { CategoryChip } from '../components/CategoryChip';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import { categoryChipForTxn } from '../lib/categoryDisplay';
import { formatMoney, moneyClass } from '../lib/money';
import {
  resolveCategory,
  resolvePayee,
  type LedgerData,
} from '../lib/dataStore';
import type { Transaction } from '../api/types';

export function RegisterPage() {
  const { accountId = '' } = useParams();
  const { data, loading, error, refresh } = useLedger();
  const [q, setQ] = useState('');
  const [clearedOnly, setClearedOnly] = useState<'all' | 'cleared' | 'uncleared'>(
    'all',
  );
  const [target, setTarget] = useState<Transaction | null>(null);

  const account = data?.accounts.find((a) => a.ynabId === accountId);

  const rows = useMemo(() => {
    if (!data) return [];
    let list = data.transactions.filter((t) => t.accountId === accountId);
    if (clearedOnly === 'cleared')
      list = list.filter((t) => t.cleared === 'cleared' || t.cleared === 'reconciled');
    if (clearedOnly === 'uncleared')
      list = list.filter((t) => t.cleared === 'uncleared');
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((t) => {
        const payee = resolvePayee(data, t.payeeId).toLowerCase();
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
  }, [data, accountId, q, clearedOnly]);

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
          <h1>{account.name}</h1>
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
          value={clearedOnly}
          onChange={(e) =>
            setClearedOnly(e.target.value as typeof clearedOnly)
          }
        >
          <option value="all">All cleared states</option>
          <option value="cleared">Cleared / reconciled</option>
          <option value="uncleared">Uncleared</option>
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
}: {
  data: LedgerData;
  rows: Transaction[];
  onCategorize?: (t: Transaction) => void;
  showAccount?: boolean;
}) {
  return (
    <div className="table-wrap panel">
      <table className="txn-table">
        <thead>
          <tr>
            <th>Date</th>
            {showAccount && <th>Account</th>}
            <th>Payee</th>
            <th>Category</th>
            <th>Memo</th>
            <th>Status</th>
            <th className="num">Outflow</th>
            <th className="num">Inflow</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="muted">
                No transactions
              </td>
            </tr>
          )}
          {rows.map((t) => {
            const outflow = t.amount < 0 ? t.amount : 0;
            const inflow = t.amount > 0 ? t.amount : 0;
            const acct = data.accounts.find((a) => a.ynabId === t.accountId);
            const canEditCategory = !!onCategorize && !t.transferAccountId;
            const chip = categoryChipForTxn(data, t);
            return (
              <tr key={t.ynabId}>
                <td className="mono">{t.date}</td>
                {showAccount && (
                  <td>
                    <Link to={`/accounts/${t.accountId}`}>
                      {acct?.name || '—'}
                    </Link>
                  </td>
                )}
                <td>{resolvePayee(data, t.payeeId)}</td>
                <td
                  className={
                    !t.categoryId && !t.transferAccountId ? 'warn' : undefined
                  }
                >
                  {canEditCategory ? (
                    <button
                      type="button"
                      className="txn-cat-btn"
                      title={
                        t.categoryId
                          ? 'Change category (saves to cloud + YNAB)'
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
                <td className="muted">{t.memo || ''}</td>
                <td>
                  <span className={`pill pill-${t.cleared}`}>
                    {t.cleared}
                    {!t.approved ? ' · pending' : ''}
                  </span>
                </td>
                <td className={`num mono ${moneyClass(outflow)}`}>
                  {outflow ? formatMoney(outflow) : ''}
                </td>
                <td className={`num mono ${moneyClass(inflow)}`}>
                  {inflow ? formatMoney(inflow) : ''}
                </td>
                <td>
                  {canEditCategory && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onCategorize?.(t)}
                    >
                      {t.categoryId ? 'Change category' : 'Categorize'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="table-foot muted small">
        {rows.length.toLocaleString()} transactions
        {onCategorize
          ? ' · click a category to change it (syncs to cloud + YNAB)'
          : ''}
      </div>
    </div>
  );
}
