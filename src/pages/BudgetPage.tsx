import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import {
  formatMoney,
  formatMonth,
  moneyClass,
  monthKey,
} from '../lib/money';
import { isInboxTxn } from '../lib/dataStore';

export function BudgetPage() {
  const { data, loading, error, refresh } = useLedger();

  const summary = useMemo(() => {
    if (!data) return null;
    const onBudget = data.accounts.filter((a) => a.onBudget && !a.closed);
    const tracking = data.accounts.filter((a) => !a.onBudget && !a.closed);
    const budgetTotal = onBudget.reduce((s, a) => s + a.balance, 0);
    const trackingTotal = tracking.reduce((s, a) => s + a.balance, 0);
    const inbox = data.transactions.filter((t) => isInboxTxn(t, data));
    const thisMonth = monthKey(new Date().toISOString().slice(0, 10));
    const monthTxns = data.transactions.filter(
      (t) =>
        monthKey(t.date) === thisMonth &&
        !t.transferAccountId &&
        t.approved !== false,
    );
    const inflow = monthTxns
      .filter((t) => t.amount > 0)
      .reduce((s, t) => s + t.amount, 0);
    const outflow = monthTxns
      .filter((t) => t.amount < 0)
      .reduce((s, t) => s + t.amount, 0);

    // Spending by category this month
    const byCat = new Map<string, number>();
    for (const t of monthTxns) {
      if (t.amount >= 0) continue;
      const key = t.categoryId || '__uncat';
      byCat.set(key, (byCat.get(key) || 0) + t.amount);
    }
    const topSpend = [...byCat.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, 8)
      .map(([id, amt]) => {
        const cat = data.categories.find((c) => c.ynabId === id);
        const name =
          id === '__uncat'
            ? 'Uncategorized'
            : cat?.name || 'Unknown';
        return { id, name, amt };
      });

    return {
      budgetTotal,
      trackingTotal,
      onBudget,
      tracking,
      inbox,
      thisMonth,
      inflow,
      outflow,
      topSpend,
      net: inflow + outflow,
    };
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error && !data)
    return <ErrorPanel message={error} onRetry={() => void refresh()} />;
  if (!data || !summary) return <Loading />;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{data.plan.name}</h1>
          <p className="muted">
            {formatMonth(summary.thisMonth)} · server knowledge{' '}
            {data.plan.serverKnowledge}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void refresh(true)}
        >
          Refresh
        </button>
      </header>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">On budget</div>
          <div className={`stat-value ${moneyClass(summary.budgetTotal)}`}>
            {formatMoney(summary.budgetTotal)}
          </div>
          <div className="muted small">
            {summary.onBudget.length} accounts
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Tracking</div>
          <div className={`stat-value ${moneyClass(summary.trackingTotal)}`}>
            {formatMoney(summary.trackingTotal)}
          </div>
          <div className="muted small">
            {summary.tracking.length} accounts
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Inflow (month)</div>
          <div className={`stat-value ${moneyClass(summary.inflow)}`}>
            {formatMoney(summary.inflow)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Outflow (month)</div>
          <div className={`stat-value ${moneyClass(summary.outflow)}`}>
            {formatMoney(summary.outflow)}
          </div>
        </div>
      </div>

      {summary.inbox.length > 0 && (
        <section className="panel alert-panel">
          <div>
            <strong>{summary.inbox.length} to approve or categorize</strong>
            <p className="muted">
              Select transactions, categorize in bulk, then approve
            </p>
          </div>
          <Link to="/inbox" className="btn btn-primary">
            Open Categorization
          </Link>
        </section>
      )}

      <div className="two-col">
        <section className="panel">
          <h2>Top spending · {formatMonth(summary.thisMonth)}</h2>
          {summary.topSpend.length === 0 ? (
            <p className="muted">No outflows this month.</p>
          ) : (
            <ul className="ranked-list">
              {summary.topSpend.map((row) => (
                <li key={row.id}>
                  <span>{row.name}</span>
                  <span className={moneyClass(row.amt)}>
                    {formatMoney(row.amt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Quick links</h2>
          <div className="quick-links">
            <Link to="/accounts">Accounts & registers</Link>
            <Link to="/transactions">Search all transactions</Link>
            <Link to="/categories">Browse categories</Link>
            <Link to="/reports">Reflect · spending</Link>
            <Link to="/more">Sync & plan details</Link>
          </div>
          {data.stats && (
            <p className="muted small" style={{ marginTop: 16 }}>
              Cloud ledger: {data.stats.itemCount.toLocaleString()} items ·{' '}
              {data.stats.byType.transaction?.toLocaleString() || 0} transactions ·{' '}
              {data.stats.byType.payee?.toLocaleString() || 0} payees
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
