import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import { formatMoney, moneyClass } from '../lib/money';
import { accountTypeLabel } from '../lib/dataStore';

export function AccountsPage() {
  const { data, loading, error, refresh } = useLedger();
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    if (!data) return null;
    const needle = q.trim().toLowerCase();
    const open = data.accounts.filter((a) => !a.closed);
    const match = (name: string) =>
      !needle || name.toLowerCase().includes(needle);
    const budget = open.filter((a) => a.onBudget && match(a.name));
    const tracking = open.filter((a) => !a.onBudget && match(a.name));
    const budgetTotal = budget.reduce((s, a) => s + a.balance, 0);
    const trackingTotal = tracking.reduce((s, a) => s + a.balance, 0);
    return { budget, tracking, budgetTotal, trackingTotal };
  }, [data, q]);

  if (loading && !data) return <Loading />;
  if (error && !data)
    return <ErrorPanel message={error} onRetry={() => void refresh()} />;
  if (!data || !groups) return <Loading />;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Accounts</h1>
          <p className="muted">
            Balances from R2Finance cloud ledger (YNAB milliunits)
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

      <input
        className="input search"
        placeholder="Filter accounts…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <AccountGroup
        title="Budget accounts"
        total={groups.budgetTotal}
        accounts={groups.budget}
      />
      <AccountGroup
        title="Tracking accounts"
        total={groups.trackingTotal}
        accounts={groups.tracking}
      />
    </div>
  );
}

function AccountGroup({
  title,
  total,
  accounts,
}: {
  title: string;
  total: number;
  accounts: {
    ynabId: string;
    name: string;
    type: string;
    balance: number;
  }[];
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <span className={`mono ${moneyClass(total)}`}>{formatMoney(total)}</span>
      </div>
      {accounts.length === 0 ? (
        <p className="muted">No accounts</p>
      ) : (
        <ul className="account-list">
          {accounts.map((a) => (
            <li key={a.ynabId}>
              <Link to={`/accounts/${a.ynabId}`} className="account-row">
                <div>
                  <div className="row-title">{a.name}</div>
                  <div className="muted small">
                    {accountTypeLabel(a.type)}
                  </div>
                </div>
                <div className={`mono ${moneyClass(a.balance)}`}>
                  {formatMoney(a.balance)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
