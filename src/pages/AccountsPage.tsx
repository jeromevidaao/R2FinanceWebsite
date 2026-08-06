import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import {
  ACCOUNT_GROUPS,
  accountGroupKey,
  accountTypeLabel,
  inferInstitution,
  type AccountGroupKey,
} from '../lib/accountGroups';
import { formatMoney, moneyClass } from '../lib/money';
import type { Account } from '../api/types';

interface GroupedAccounts {
  key: AccountGroupKey;
  title: string;
  accounts: Account[];
  total: number;
}

export function AccountsPage() {
  const { data, loading, error, refresh } = useLedger();
  const [q, setQ] = useState('');
  const [showAddHint, setShowAddHint] = useState(false);

  const groups = useMemo((): GroupedAccounts[] | null => {
    if (!data) return null;
    const needle = q.trim().toLowerCase();
    const open = data.accounts.filter((a) => !a.closed);
    const match = (name: string) =>
      !needle || name.toLowerCase().includes(needle);

    const buckets: Record<AccountGroupKey, Account[]> = {
      cash: [],
      credit: [],
      tracking: [],
    };

    for (const a of open) {
      if (!match(a.name)) continue;
      buckets[accountGroupKey(a.type, a.onBudget)].push(a);
    }

    // Stable name sort within each group
    for (const key of Object.keys(buckets) as AccountGroupKey[]) {
      buckets[key].sort((x, y) => x.name.localeCompare(y.name));
    }

    return ACCOUNT_GROUPS.map((g) => {
      const accounts = buckets[g.key];
      const total = accounts.reduce((s, a) => s + a.balance, 0);
      return { key: g.key, title: g.title, accounts, total };
    }).filter((g) => g.accounts.length > 0 || !needle);
  }, [data, q]);

  if (loading && !data) return <Loading />;
  if (error && !data)
    return <ErrorPanel message={error} onRetry={() => void refresh()} />;
  if (!data || !groups) return <Loading />;

  const netCash =
    groups.find((g) => g.key === 'cash')?.total ?? 0;
  const creditTotal =
    groups.find((g) => g.key === 'credit')?.total ?? 0;

  return (
    <div className="page accounts-page">
      <header className="page-header">
        <div>
          <h1>Accounts</h1>
          <p className="muted">
            Cash, credit, and tracking balances · open a register to review
            activity
          </p>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void refresh(true)}
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary accounts-add-btn"
            title="Add account"
            aria-label="Add account"
            onClick={() => setShowAddHint(true)}
          >
            +
          </button>
        </div>
      </header>

      <div className="accounts-summary">
        <div className="stat-card accounts-summary-card">
          <div className="stat-label">Cash</div>
          <div className={`stat-value mono ${moneyClass(netCash)}`}>
            {formatMoney(netCash)}
          </div>
        </div>
        <div className="stat-card accounts-summary-card">
          <div className="stat-label">Credit</div>
          <div className={`stat-value mono ${moneyClass(creditTotal)}`}>
            {formatMoney(creditTotal)}
          </div>
        </div>
      </div>

      <input
        className="input search"
        placeholder="Filter accounts…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Filter accounts"
      />

      {groups.every((g) => g.accounts.length === 0) ? (
        <section className="panel">
          <p className="muted">No accounts match this filter.</p>
        </section>
      ) : (
        groups.map((g) => (
          <AccountGroupSection key={g.key} group={g} />
        ))
      )}

      {showAddHint && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setShowAddHint(false)}
        >
          <div
            className="modal panel"
            role="dialog"
            aria-labelledby="add-account-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="add-account-title">Add account</h2>
            <p className="muted">
              New accounts are created in YNAB (or the Android app) and appear
              here after the next cloud sync. R2Finance mirrors your working
              balances — it does not replace YNAB account setup.
            </p>
            <div className="btn-row" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowAddHint(false)}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountGroupSection({ group }: { group: GroupedAccounts }) {
  return (
    <section className="panel account-group-panel" data-group={group.key}>
      <div className="panel-head account-group-head">
        <h2>{group.title}</h2>
        <span className={`mono account-group-total ${moneyClass(group.total)}`}>
          {formatMoney(group.total)}
        </span>
      </div>
      {group.accounts.length === 0 ? (
        <p className="muted">No accounts</p>
      ) : (
        <ul className="account-list">
          {group.accounts.map((a) => (
            <li key={a.ynabId}>
              <AccountRow account={a} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AccountRow({ account }: { account: Account }) {
  const brand = inferInstitution(account.name, account.type, account.onBudget);
  return (
    <Link to={`/accounts/${account.ynabId}`} className="account-row">
      <span
        className="account-icon"
        style={{ background: brand.bg, color: brand.fg }}
        title={brand.label}
        aria-hidden
      >
        {brand.mark}
      </span>
      <div className="account-row-main">
        <div className="row-title">{account.name}</div>
        <div className="muted small">{accountTypeLabel(account.type)}</div>
      </div>
      <div className={`mono account-balance ${moneyClass(account.balance)}`}>
        {formatMoney(account.balance)}
      </div>
    </Link>
  );
}
