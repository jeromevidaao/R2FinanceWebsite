import { useMemo, useState } from 'react';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import { formatMoney, moneyClass } from '../lib/money';

export function PayeesPage() {
  const { data, loading, error, refresh } = useLedger();
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    if (!data) return [];
    const totals = new Map<string, { count: number; sum: number }>();
    for (const t of data.transactions) {
      if (!t.payeeId) continue;
      const cur = totals.get(t.payeeId) || { count: 0, sum: 0 };
      cur.count += 1;
      cur.sum += t.amount;
      totals.set(t.payeeId, cur);
    }
    const needle = q.trim().toLowerCase();
    return data.payees
      .filter((p) => !p.transferAccountId)
      .filter((p) => !needle || p.name.toLowerCase().includes(needle))
      .map((p) => ({
        ...p,
        count: totals.get(p.ynabId)?.count || 0,
        sum: totals.get(p.ynabId)?.sum || 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 200);
  }, [data, q]);

  if (loading && !data) return <Loading />;
  if (error && !data)
    return <ErrorPanel message={error} onRetry={() => void refresh()} />;
  if (!data) return <Loading />;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Payees</h1>
          <p className="muted">
            {data.payees.length.toLocaleString()} payees · top 200 by activity
          </p>
        </div>
      </header>

      <input
        className="input search"
        placeholder="Search payees…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="table-wrap panel">
        <table className="txn-table">
          <thead>
            <tr>
              <th>Payee</th>
              <th className="num">Txns</th>
              <th className="num">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.ynabId}>
                <td>{p.name}</td>
                <td className="num mono">{p.count}</td>
                <td className={`num mono ${moneyClass(p.sum)}`}>
                  {p.count ? formatMoney(p.sum) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
