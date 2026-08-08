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
import { buildSpendingReport } from '../lib/analytics';

export function BudgetPage() {
  const { data, loading, error, refresh } = useLedger();

  const summary = useMemo(() => {
    if (!data) return null;
    const openAccounts = data.accounts.filter((a) => !a.closed);
    const accountsTotal = openAccounts.reduce((s, a) => s + a.balance, 0);
    const inbox = data.transactions.filter((t) => isInboxTxn(t, data));
    const thisMonth = monthKey(new Date().toISOString().slice(0, 10));
    // Same YNAB-aligned formula as Reflect (net spending, RTA = income).
    const report = buildSpendingReport({
      transactions: data.transactions,
      categories: data.categories,
      groups: data.groups,
      payees: data.payees,
      accounts: data.accounts,
      mode: 'month',
      periodKey: thisMonth,
    });
    const topSpend = report.byCategory.slice(0, 8).map((r) => ({
      id: r.id,
      name: r.name,
      amt: r.amount,
    }));

    return {
      accountsTotal,
      openCount: openAccounts.length,
      inbox,
      thisMonth,
      inflow: report.inflow,
      outflow: report.outflow,
      topSpend,
      net: report.net,
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
          <div className="stat-label">Accounts</div>
          <div className={`stat-value ${moneyClass(summary.accountsTotal)}`}>
            {formatMoney(summary.accountsTotal)}
          </div>
          <div className="muted small">{summary.openCount} open</div>
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
        <div className="stat-card">
          <div className="stat-label">Net (month)</div>
          <div className={`stat-value ${moneyClass(summary.net)}`}>
            {formatMoney(summary.net)}
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
            <Link to="/aliases">Account aliases / nicknames</Link>
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
