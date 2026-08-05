import { useMemo, useState } from 'react';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import { formatMoney, formatMonth, moneyClass, monthKey } from '../lib/money';

export function ReportsPage() {
  const { data, loading, error, refresh } = useLedger();
  const months = useMemo(() => {
    if (!data) return [];
    const set = new Set(data.transactions.map((t) => monthKey(t.date)));
    return [...set].sort().reverse().slice(0, 24);
  }, [data]);
  const [month, setMonth] = useState(months[0] || monthKey(new Date().toISOString().slice(0, 10)));

  const report = useMemo(() => {
    if (!data) return null;
    const m = month || months[0];
    const txns = data.transactions.filter(
      (t) => monthKey(t.date) === m && !t.transferAccountId,
    );
    const inflow = txns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const outflow = txns.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);

    const byCat = new Map<string, number>();
    const byPayee = new Map<string, number>();
    const byAccount = new Map<string, number>();

    for (const t of txns) {
      if (t.amount < 0) {
        const ck = t.categoryId || '__uncat';
        byCat.set(ck, (byCat.get(ck) || 0) + t.amount);
        if (t.payeeId) byPayee.set(t.payeeId, (byPayee.get(t.payeeId) || 0) + t.amount);
      }
      byAccount.set(t.accountId, (byAccount.get(t.accountId) || 0) + t.amount);
    }

    const catRows = [...byCat.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id, amt]) => ({
        id,
        name:
          id === '__uncat'
            ? 'Uncategorized'
            : data.categories.find((c) => c.ynabId === id)?.name || 'Unknown',
        amt,
      }));

    const payeeRows = [...byPayee.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, 25)
      .map(([id, amt]) => ({
        id,
        name: data.payees.find((p) => p.ynabId === id)?.name || 'Unknown',
        amt,
      }));

    const accountRows = [...byAccount.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id, amt]) => ({
        id,
        name: data.accounts.find((a) => a.ynabId === id)?.name || 'Unknown',
        amt,
      }));

    // Trend last 6 months
    const trend = months.slice(0, 6).reverse().map((ym) => {
      const list = data.transactions.filter(
        (t) => monthKey(t.date) === ym && !t.transferAccountId,
      );
      const inF = list.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const outF = list.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
      return { ym, inF, outF, net: inF + outF };
    });

    return { m, inflow, outflow, net: inflow + outflow, catRows, payeeRows, accountRows, trend, count: txns.length };
  }, [data, month, months]);

  if (loading && !data) return <Loading />;
  if (error && !data)
    return <ErrorPanel message={error} onRetry={() => void refresh()} />;
  if (!data || !report) return <Loading />;

  const maxOut = Math.max(...report.trend.map((t) => Math.abs(t.outF)), 1);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="muted">Spending analytics from your cloud ledger</p>
        </div>
        <select
          className="input"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {formatMonth(m)}
            </option>
          ))}
        </select>
      </header>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Inflow</div>
          <div className={`stat-value ${moneyClass(report.inflow)}`}>
            {formatMoney(report.inflow)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Outflow</div>
          <div className={`stat-value ${moneyClass(report.outflow)}`}>
            {formatMoney(report.outflow)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Net</div>
          <div className={`stat-value ${moneyClass(report.net)}`}>
            {formatMoney(report.net)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Transactions</div>
          <div className="stat-value">{report.count}</div>
        </div>
      </div>

      <section className="panel">
        <h2>6-month trend</h2>
        <div className="bars">
          {report.trend.map((t) => (
            <div key={t.ym} className="bar-col">
              <div className="bar-track">
                <div
                  className="bar bar-out"
                  style={{ height: `${(Math.abs(t.outF) / maxOut) * 100}%` }}
                  title={`Out ${formatMoney(t.outF)}`}
                />
              </div>
              <div className="bar-label">{t.ym.slice(5)}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="two-col">
        <section className="panel">
          <h2>By category</h2>
          <ul className="ranked-list">
            {report.catRows.slice(0, 20).map((r) => (
              <li key={r.id}>
                <span>{r.name}</span>
                <span className={`mono ${moneyClass(r.amt)}`}>
                  {formatMoney(r.amt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h2>By payee</h2>
          <ul className="ranked-list">
            {report.payeeRows.map((r) => (
              <li key={r.id}>
                <span>{r.name}</span>
                <span className={`mono ${moneyClass(r.amt)}`}>
                  {formatMoney(r.amt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="panel">
        <h2>By account (net)</h2>
        <ul className="ranked-list">
          {report.accountRows.map((r) => (
            <li key={r.id}>
              <span>{r.name}</span>
              <span className={`mono ${moneyClass(r.amt)}`}>
                {formatMoney(r.amt)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
