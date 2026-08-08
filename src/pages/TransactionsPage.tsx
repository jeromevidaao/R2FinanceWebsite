import { useMemo, useState } from 'react';
import { CategorizeModal } from '../components/CategorizeModal';
import { ErrorPanel, Loading } from '../components/Loading';
import { TxnTable } from './RegisterPage';
import { useLedger } from '../hooks/useLedger';
import { resolveCategory, resolvePayee } from '../lib/dataStore';
import type { Transaction } from '../api/types';

export function TransactionsPage() {
  const { data, loading, error, refresh } = useLedger();
  const [q, setQ] = useState('');
  const [accountId, setAccountId] = useState('');
  const [month, setMonth] = useState('');
  const [uncatOnly, setUncatOnly] = useState(false);
  const [target, setTarget] = useState<Transaction | null>(null);

  const months = useMemo(() => {
    if (!data) return [];
    const set = new Set(data.transactions.map((t) => t.date.slice(0, 7)));
    return [...set].sort().reverse();
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    let list = data.transactions;
    if (accountId) list = list.filter((t) => t.accountId === accountId);
    if (month) list = list.filter((t) => t.date.startsWith(month));
    if (uncatOnly)
      list = list.filter((t) => !t.categoryId && !t.transferAccountId);
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((t) => {
        const payee = resolvePayee(data, t.payeeId).toLowerCase();
        const cat = resolveCategory(data, t.categoryId, t).toLowerCase();
        const memo = (t.memo || '').toLowerCase();
        const acct =
          data.accounts
            .find((a) => a.ynabId === t.accountId)
            ?.name.toLowerCase() || '';
        return (
          payee.includes(needle) ||
          cat.includes(needle) ||
          memo.includes(needle) ||
          acct.includes(needle) ||
          t.date.includes(needle)
        );
      });
    }
    return list.slice(0, 500);
  }, [data, q, accountId, month, uncatOnly]);

  if (loading && !data) return <Loading />;
  if (error && !data)
    return <ErrorPanel message={error} onRetry={() => void refresh()} />;
  if (!data) return <Loading />;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>All transactions</h1>
          <p className="muted">
            {data.transactions.length.toLocaleString()} in ledger · showing up
            to 500 matches · change any category to save to R2Finance + YNAB
          </p>
        </div>
      </header>

      <div className="toolbar wrap">
        <input
          className="input search"
          placeholder="Search payee, category, memo, account…"
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
              {a.name}
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
      </div>

      <TxnTable
        data={data}
        rows={rows}
        showAccount
        onCategorize={setTarget}
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
