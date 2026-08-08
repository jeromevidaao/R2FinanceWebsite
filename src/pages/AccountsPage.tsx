import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  connectorsApi,
  getEmail,
  type ConnectorAccountPreview,
  type ConnectorId,
  type ConnectorStatus,
  type HouseholdConnectors,
} from '../api/client';
import { ErrorPanel, Loading } from '../components/Loading';
import { formatMoney, moneyClass } from '../lib/money';

type BankDef = {
  id: ConnectorId;
  name: string;
  short: string;
  logoClass: string;
};

const BANKS: BankDef[] = [
  { id: 'boa', name: 'Bank of America', short: 'BoA', logoClass: 'connector-logo boa' },
  { id: 'chase', name: 'Chase', short: 'Chase', logoClass: 'connector-logo chase' },
  {
    id: 'vanguard',
    name: 'Vanguard',
    short: 'VG',
    logoClass: 'connector-logo vanguard',
  },
  { id: 'venmo', name: 'Venmo', short: 'Venmo', logoClass: 'connector-logo venmo' },
];

function bankMeta(id: string | undefined): BankDef {
  const found = BANKS.find((b) => b.id === id);
  return (
    found || {
      id: (id || 'boa') as ConnectorId,
      name: id || 'Bank',
      short: (id || '?').slice(0, 3).toUpperCase(),
      logoClass: 'connector-logo',
    }
  );
}

/** Prefer Plaid available; fall back to current. */
function displayAmount(a: ConnectorAccountPreview): number | null {
  if (a.available != null && !Number.isNaN(Number(a.available))) {
    return Number(a.available);
  }
  if (a.current != null && !Number.isNaN(Number(a.current))) {
    return Number(a.current);
  }
  return null;
}

function isCredit(a: ConnectorAccountPreview): boolean {
  const t = String(a.type || '').toLowerCase();
  const s = String(a.subtype || '').toLowerCase();
  return t === 'credit' || s === 'credit card' || s === 'paypal';
}

function formatUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return formatMoney(Math.round(n * 1000));
}

function shortEmail(email: string | undefined): string {
  if (!email) return '';
  const local = email.split('@')[0] || email;
  return local;
}

type AccountRow = {
  key: string;
  ownerEmail: string;
  connectorId: string;
  institutionName: string;
  account: ConnectorAccountPreview;
  amount: number | null;
  credit: boolean;
};

export function AccountsPage() {
  const sessionEmail = getEmail();
  const [household, setHousehold] = useState<HouseholdConnectors | null>(null);
  const [mine, setMine] = useState<ConnectorStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [listed, hh] = await Promise.all([
        connectorsApi.list(),
        connectorsApi.household().catch(() => null),
      ]);
      setMine(listed.connectors || []);
      setHousehold(hh);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Prefer household (all members) so capital covers Jerome + Ngoc. */
  const connectors: ConnectorStatus[] = useMemo(() => {
    if (household?.users?.length) {
      return household.users.flatMap((u) =>
        (u.connectors || []).map((c) => ({
          ...c,
          email: c.email || u.email,
          provider: c.provider || 'plaid',
          institution: c.institution || c.institutionName || '',
          configured: c.configured ?? true,
          connected: !!c.connected,
        })),
      );
    }
    return mine;
  }, [household, mine]);

  const rows: AccountRow[] = useMemo(() => {
    const out: AccountRow[] = [];
    for (const c of connectors) {
      if (!c.connected) continue;
      const preview = c.accountsPreview || [];
      for (const a of preview) {
        out.push({
          key: `${c.email || ''}-${c.connectorId}-${a.accountId}`,
          ownerEmail: c.email || sessionEmail || '',
          connectorId: String(c.connectorId || ''),
          institutionName: c.institutionName || c.institution || bankMeta(String(c.connectorId)).name,
          account: a,
          amount: displayAmount(a),
          credit: isCredit(a),
        });
      }
    }
    out.sort((x, y) => {
      if (x.credit !== y.credit) return x.credit ? 1 : -1;
      return (
        x.institutionName.localeCompare(y.institutionName) ||
        x.account.name.localeCompare(y.account.name)
      );
    });
    return out;
  }, [connectors, sessionEmail]);

  const capital = useMemo(() => {
    // Non-credit: available (or current). Credit: show owed separately.
    let assets = 0;
    let creditOwed = 0;
    let hasAssets = false;
    let hasCredit = false;
    for (const r of rows) {
      if (r.amount == null) continue;
      if (r.credit) {
        // Plaid current is typically positive balance owed
        creditOwed += Math.abs(r.amount);
        hasCredit = true;
      } else {
        assets += r.amount;
        hasAssets = true;
      }
    }
    return {
      assets: hasAssets ? assets : null,
      creditOwed: hasCredit ? creditOwed : null,
      net:
        hasAssets || hasCredit
          ? (hasAssets ? assets : 0) - (hasCredit ? creditOwed : 0)
          : null,
    };
  }, [rows]);

  const connectedCount = connectors.filter((c) => c.connected).length;
  const lastBalancesAt = useMemo(() => {
    let max = 0;
    for (const c of connectors) {
      const t = c.lastBalancesAt || 0;
      if (t > max) max = t;
    }
    return max || null;
  }, [connectors]);

  async function refreshBalances() {
    if (refreshing) return;
    setRefreshing(true);
    setMsg('Refreshing balances from Plaid (once)…');
    try {
      const res = await connectorsApi.refreshBalances();
      const ok = res.results?.filter((r) => r.ok).length ?? 0;
      const fail = res.results?.filter((r) => r.ok === false).length ?? 0;
      setMsg(
        `Updated ${ok} connector(s)${fail ? ` · ${fail} failed` : ''}. Showing connector cache.`,
      );
      await load();
    } catch (e) {
      setMsg(
        `Balance refresh failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setRefreshing(false);
    }
  }

  if (loading && !connectors.length && !error) return <Loading />;
  if (error && !connectors.length)
    return <ErrorPanel message={error} onRetry={() => void load()} />;

  const assetRows = rows.filter((r) => !r.credit);
  const creditRows = rows.filter((r) => r.credit);

  return (
    <div className="page accounts-page">
      <header className="page-header">
        <div>
          <h1>Accounts</h1>
          <p className="muted">
            Connectors and capital · balances from bank links (cached). Plaid
            is used for transaction match and optional balance refresh only.
          </p>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={refreshing}
            onClick={() => void load()}
          >
            Reload
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={refreshing || connectedCount === 0}
            onClick={() => void refreshBalances()}
            title="Live Plaid accounts/get once, then show cache"
          >
            {refreshing ? 'Refreshing…' : 'Refresh balances'}
          </button>
        </div>
      </header>

      <div className="accounts-summary">
        <div className="stat-card accounts-summary-card">
          <div className="stat-label">Capital</div>
          <div
            className={`stat-value mono ${moneyClass(
              capital.net != null ? Math.round(capital.net * 1000) : 0,
            )}`}
          >
            {formatUsd(capital.net)}
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            Assets − credit owed
          </div>
        </div>
        <div className="stat-card accounts-summary-card">
          <div className="stat-label">Assets</div>
          <div
            className={`stat-value mono ${moneyClass(
              capital.assets != null ? Math.round(capital.assets * 1000) : 0,
            )}`}
          >
            {formatUsd(capital.assets)}
          </div>
        </div>
        <div className="stat-card accounts-summary-card">
          <div className="stat-label">Credit owed</div>
          <div
            className={`stat-value mono ${moneyClass(
              capital.creditOwed != null
                ? -Math.round(capital.creditOwed * 1000)
                : 0,
            )}`}
          >
            {formatUsd(capital.creditOwed)}
          </div>
        </div>
      </div>

      <p className="muted small" style={{ marginBottom: 12 }}>
        {connectedCount} connected bank link
        {connectedCount === 1 ? '' : 's'}
        {lastBalancesAt
          ? ` · balances as of ${new Date(lastBalancesAt).toLocaleString()}`
          : ' · tap Refresh balances to pull available amounts from Plaid once'}
        {' · '}
        <Link to="/connectors">Manage connectors</Link>
      </p>

      {connectedCount === 0 ? (
        <section className="panel">
          <h2>No bank connectors yet</h2>
          <p className="muted">
            Link BoA, Chase, Vanguard, or Venmo under Connectors. Accounts will
            show each account’s available balance from the connector cache — not
            the YNAB ledger.
          </p>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <Link className="btn btn-primary" to="/connectors">
              Open Connectors
            </Link>
          </div>
        </section>
      ) : rows.length === 0 ? (
        <section className="panel">
          <h2>Connected — balances not cached yet</h2>
          <p className="muted">
            Banks are linked, but this session has not stored available amounts
            on the connector yet. Tap <strong>Refresh balances</strong> once
            (live Plaid accounts/get) — after that, Accounts loads from the
            connector only.
          </p>
        </section>
      ) : (
        <>
          {assetRows.length > 0 && (
            <AccountSection title="Cash & investments" rows={assetRows} />
          )}
          {creditRows.length > 0 && (
            <AccountSection title="Credit" rows={creditRows} />
          )}
        </>
      )}

      {/* Connector status strip (connected / not) */}
      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h2>Connectors</h2>
          <Link to="/connectors" className="muted small">
            Manage →
          </Link>
        </div>
        <ul className="account-list">
          {BANKS.map((bank) => {
            const linked = connectors.filter(
              (c) =>
                String(c.connectorId || '').toLowerCase() === bank.id &&
                c.connected,
            );
            return (
              <li key={bank.id}>
                <div className="account-row" style={{ cursor: 'default' }}>
                  <span className={bank.logoClass} aria-hidden>
                    {bank.short}
                  </span>
                  <div className="account-row-main">
                    <div className="row-title">{bank.name}</div>
                    <div className="muted small">
                      {linked.length === 0
                        ? 'Not linked'
                        : linked
                            .map(
                              (c) =>
                                `${shortEmail(c.email)}${
                                  (c.accountsPreview || []).length
                                    ? ` · ${(c.accountsPreview || []).length} acct`
                                    : ''
                                }`,
                            )
                            .join(' · ')}
                    </div>
                  </div>
                  <span
                    className={
                      linked.length > 0 ? 'pill pill-ok' : 'pill'
                    }
                  >
                    {linked.length > 0
                      ? linked.length === 1
                        ? 'Connected'
                        : `${linked.length} linked`
                      : '—'}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {msg && <pre className="sync-log">{msg}</pre>}
    </div>
  );
}

function AccountSection({
  title,
  rows,
}: {
  title: string;
  rows: AccountRow[];
}) {
  const total = rows.reduce(
    (s, r) => s + (r.amount != null ? Math.abs(r.amount) : 0),
    0,
  );
  const any = rows.some((r) => r.amount != null);

  return (
    <section className="panel account-group-panel">
      <div className="panel-head account-group-head">
        <h2>{title}</h2>
        <span
          className={`mono account-group-total ${moneyClass(
            any ? Math.round(total * 1000) : 0,
          )}`}
        >
          {any ? formatUsd(total) : '—'}
        </span>
      </div>
      <ul className="account-list">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="account-row" style={{ cursor: 'default' }}>
              <span
                className={bankMeta(r.connectorId).logoClass}
                aria-hidden
                title={r.institutionName}
              >
                {bankMeta(r.connectorId).short}
              </span>
              <div className="account-row-main">
                <div className="row-title">{r.account.name}</div>
                <div className="muted small">
                  {r.institutionName}
                  {r.account.mask ? ` · ••••${r.account.mask}` : ''}
                  {r.ownerEmail ? ` · ${shortEmail(r.ownerEmail)}` : ''}
                  {r.account.type
                    ? ` · ${[r.account.type, r.account.subtype]
                        .filter(Boolean)
                        .join(' / ')}`
                    : ''}
                </div>
              </div>
              <div
                className={`mono account-balance ${moneyClass(
                  r.amount != null
                    ? Math.round((r.credit ? -Math.abs(r.amount) : r.amount) * 1000)
                    : 0,
                )}`}
              >
                {formatUsd(r.amount)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
