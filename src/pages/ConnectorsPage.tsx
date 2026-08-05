import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import {
  connectorsApi,
  getEmail,
  type ConnectorAccounts,
  type ConnectorId,
  type ConnectorStatus,
  type HouseholdConnectors,
} from '../api/client';
import { ErrorPanel, Loading } from '../components/Loading';

type BankDef = {
  id: ConnectorId;
  name: string;
  short: string;
  logoClass: string;
  blurb: string;
};

const BANKS: BankDef[] = [
  {
    id: 'boa',
    name: 'Bank of America',
    short: 'BoA',
    logoClass: 'connector-logo boa',
    blurb: 'Plaid Link · credit cards & deposits · read-only',
  },
  {
    id: 'chase',
    name: 'Chase',
    short: 'Chase',
    logoClass: 'connector-logo chase',
    blurb: 'Plaid Link · credit cards & deposits · read-only',
  },
  {
    id: 'vanguard',
    name: 'Vanguard',
    short: 'VG',
    logoClass: 'connector-logo vanguard',
    blurb: 'Plaid Link · investments / retirement · read-only',
  },
];

const CONNECTOR_IDS: ConnectorId[] = ['boa', 'chase', 'vanguard'];

function formatUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
  });
}

const PENDING_BANK_KEY = 'r2finance_plaid_pending_bank';

function bankFromStorage(): ConnectorId | null {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search).get('bank');
  if (q === 'boa' || q === 'chase' || q === 'vanguard') return q;
  try {
    const s = sessionStorage.getItem(PENDING_BANK_KEY);
    if (s === 'boa' || s === 'chase' || s === 'vanguard') return s;
  } catch {
    /* ignore */
  }
  return null;
}

function setPendingBank(bank: ConnectorId | null) {
  try {
    if (bank) sessionStorage.setItem(PENDING_BANK_KEY, bank);
    else sessionStorage.removeItem(PENDING_BANK_KEY);
  } catch {
    /* ignore */
  }
}

export function ConnectorsPage() {
  const sessionEmail = getEmail();
  const [ownerEmail, setOwnerEmail] = useState<string | null>(sessionEmail);
  const [statuses, setStatuses] = useState<
    Partial<Record<ConnectorId, ConnectorStatus>>
  >({});
  const [accountsByBank, setAccountsByBank] = useState<
    Partial<Record<ConnectorId, ConnectorAccounts>>
  >({});
  const [household, setHousehold] = useState<HouseholdConnectors | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeBank, setActiveBank] = useState<ConnectorId | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);

  const anyStatus = useMemo(
    () => statuses.boa || statuses.chase || statuses.vanguard || null,
    [statuses],
  );
  const plaidConfigured = anyStatus?.configured ?? false;

  const load = useCallback(async () => {
    setError(null);
    try {
      const listed = await connectorsApi.list();
      const list = listed.connectors || [];
      if (listed.email) setOwnerEmail(listed.email);

      const next: Partial<Record<ConnectorId, ConnectorStatus>> = {};
      for (const s of list) {
        const id = String(s.connectorId || '').toLowerCase() as ConnectorId;
        if (CONNECTOR_IDS.includes(id)) next[id] = s;
      }
      for (const id of CONNECTOR_IDS) {
        if (!next[id]) {
          try {
            next[id] = await connectorsApi.status(id);
          } catch {
            /* bank may not be deployed yet */
          }
        }
      }
      setStatuses(next);

      const acctNext: Partial<Record<ConnectorId, ConnectorAccounts>> = {};
      for (const id of CONNECTOR_IDS) {
        if (next[id]?.connected) {
          try {
            acctNext[id] = await connectorsApi.accounts(id);
          } catch {
            /* probe optional on load */
          }
        }
      }
      setAccountsByBank(acctNext);

      try {
        setHousehold(await connectorsApi.household());
      } catch {
        setHousehold(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onPlaidSuccess = useCallback(
    async (publicToken: string | null, metadata: unknown) => {
      const bank = activeBank;
      if (!publicToken || !bank) {
        setMsg('Link returned no public token');
        setBusy(false);
        return;
      }
      setBusy(true);
      const name = BANKS.find((b) => b.id === bank)?.name || bank;
      setMsg(`Saving ${name} connection…`);
      try {
        const res = await connectorsApi.exchange(bank, publicToken, metadata);
        setMsg(
          `Connected: ${res.institutionName} · ${res.accounts.length} account(s). Transactions are not written to the ledger yet.`,
        );
        setLinkToken(null);
        setActiveBank(null);
        setPendingBank(null);
        // Clean oauth query without full reload
        if (window.location.search.includes('oauth_state_id')) {
          window.history.replaceState({}, '', '/connectors');
        }
        await load();
      } catch (e) {
        setMsg(
          `Exchange failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [activeBank, load],
  );

  const oauthRedirect =
    typeof window !== 'undefined' &&
    window.location.search.includes('oauth_state_id=')
      ? window.location.href
      : undefined;

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: onPlaidSuccess,
    onExit: (err) => {
      if (err) {
        setMsg(
          `Link closed: ${
            err.display_message || err.error_message || err.error_code || 'exit'
          }`,
        );
      }
      setBusy(false);
    },
    receivedRedirectUri: oauthRedirect,
  });

  useEffect(() => {
    if (linkToken && ready) {
      open();
    }
  }, [linkToken, ready, open]);

  // Resume OAuth return to /connectors?oauth_state_id=… (bank from sessionStorage)
  useEffect(() => {
    if (!oauthRedirect || linkToken || busy) return;
    const bank = bankFromStorage() || activeBank || 'boa';
    void (async () => {
      setBusy(true);
      setActiveBank(bank);
      setPendingBank(bank);
      try {
        const { link_token } = await connectorsApi.linkToken(bank);
        setLinkToken(link_token);
      } catch (e) {
        setMsg(
          `OAuth resume failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on oauth return
  }, [oauthRedirect]);

  async function startConnect(bank: ConnectorId) {
    setBusy(true);
    setMsg(null);
    setError(null);
    setActiveBank(bank);
    setPendingBank(bank);
    try {
      const { link_token } = await connectorsApi.linkToken(bank);
      setLinkToken(link_token);
    } catch (e) {
      setMsg(
        `Could not start Link: ${e instanceof Error ? e.message : String(e)}`,
      );
      setBusy(false);
      setActiveBank(null);
    }
  }

  async function disconnect(bank: ConnectorId) {
    const name = BANKS.find((b) => b.id === bank)?.name || bank;
    if (!window.confirm(`Disconnect ${name} from R2Finance?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      await connectorsApi.disconnect(bank);
      setMsg(`${name} disconnected.`);
      await load();
    } catch (e) {
      setMsg(
        `Disconnect failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function refreshAccounts(bank: ConnectorId) {
    setBusy(true);
    setMsg(null);
    try {
      const a = await connectorsApi.accounts(bank);
      setAccountsByBank((prev) => ({ ...prev, [bank]: a }));
      setMsg(
        `Probed ${a.accounts.length} ${a.institutionName || bank} account(s) live from Plaid.`,
      );
    } catch (e) {
      setMsg(`Probe failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !anyStatus) return <Loading />;
  if (error && !anyStatus)
    return <ErrorPanel message={error} onRetry={() => void load()} />;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Connectors</h1>
          <p className="muted">
            Per-person bank links (BoA, Chase, Vanguard). Each household member
            connects their own accounts — access only, nothing written to the
            DDB ledger yet.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          Refresh
        </button>
      </header>

      <section className="panel">
        <h2>Your links</h2>
        <p className="muted small">
          Signed in as <strong>{ownerEmail || sessionEmail || '—'}</strong>.
          Connect buttons below only update this email’s connectors. Ngoc signs
          in with her account to link her own BoA / Chase / Vanguard.
        </p>
      </section>

      {!plaidConfigured && (
        <div className="alert alert-info">
          <p>
            <strong>Setup required:</strong> Plaid API keys must be in AWS SSM
            SecureString <code>/r2finance/plaid</code> (never in git).
          </p>
          <pre className="sync-log">{`aws ssm put-parameter --name /r2finance/plaid --type SecureString \\
  --value '{"client_id":"…","secret":"…","env":"production"}' --overwrite`}</pre>
          <p className="muted small">
            Register OAuth redirect{' '}
            <code>https://finance.i-liquid.be/connectors</code> in the Plaid
            dashboard (no query string — Plaid rejects those).
          </p>
        </div>
      )}

      {BANKS.map((bank) => {
        const status = statuses[bank.id];
        const accounts = accountsByBank[bank.id];
        return (
          <section key={bank.id} className="panel connector-card">
            <div className="connector-head">
              <div className={bank.logoClass} aria-hidden>
                {bank.short}
              </div>
              <div>
                <h2>{bank.name}</h2>
                <p className="muted small">
                  {bank.blurb} · owner {status?.email || ownerEmail || '—'}
                </p>
              </div>
              <span
                className={
                  status?.connected
                    ? 'pill pill-ok'
                    : status?.configured
                      ? 'pill pill-warn'
                      : 'pill'
                }
              >
                {status?.connected
                  ? 'Connected'
                  : status?.configured
                    ? 'Ready to connect'
                    : 'Needs Plaid keys'}
              </span>
            </div>

            <dl className="kv">
              <div>
                <dt>Linked to</dt>
                <dd>{status?.email || ownerEmail || '—'}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>{status?.provider || 'plaid'}</dd>
              </div>
              <div>
                <dt>Institution</dt>
                <dd>{status?.institutionName || bank.name}</dd>
              </div>
              <div>
                <dt>Item id</dt>
                <dd className="mono small">{status?.itemId || '—'}</dd>
              </div>
              <div>
                <dt>Connected at</dt>
                <dd>
                  {status?.connectedAt
                    ? new Date(status.connectedAt).toLocaleString()
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>Ledger import</dt>
                <dd>Off (by design for this phase)</dd>
              </div>
            </dl>

            <div className="btn-row">
              {!status?.connected ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !status?.configured}
                  onClick={() => void startConnect(bank.id)}
                >
                  Connect {bank.name}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void refreshAccounts(bank.id)}
                  >
                    Probe accounts
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => void startConnect(bank.id)}
                  >
                    Reconnect
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => void disconnect(bank.id)}
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>

            {accounts && accounts.accounts.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 14 }}>
                <h3 className="group-title" style={{ marginTop: 0 }}>
                  Live accounts (Plaid)
                </h3>
                <p className="muted small">
                  Source: {accounts.source} · not stored as ledger transactions
                </p>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Mask</th>
                      <th className="num">Available</th>
                      <th className="num">Current</th>
                      <th className="num">Limit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.accounts.map((a) => (
                      <tr key={a.accountId}>
                        <td>
                          <div>{a.name}</div>
                          {a.officialName && a.officialName !== a.name && (
                            <div className="muted small">{a.officialName}</div>
                          )}
                        </td>
                        <td className="muted">
                          {[a.type, a.subtype].filter(Boolean).join(' · ')}
                        </td>
                        <td className="mono">
                          {a.mask ? `••••${a.mask}` : '—'}
                        </td>
                        <td className="num mono">
                          {formatUsd(a.balances.available)}
                        </td>
                        <td className="num mono">
                          {formatUsd(a.balances.current)}
                        </td>
                        <td className="num mono">
                          {formatUsd(a.balances.limit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {msg && <pre className="sync-log">{msg}</pre>}

      {household && household.users.length > 0 && (
        <section className="panel">
          <h2>Household overview</h2>
          <p className="muted small">
            Each person can link the same bank types independently (e.g. 2×
            BoA, 2× Chase, 2× Vanguard).
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Bank</th>
                  <th>Status</th>
                  <th className="num">Accounts</th>
                </tr>
              </thead>
              <tbody>
                {household.users.flatMap((u) =>
                  u.connectors.map((c) => (
                    <tr key={`${u.email}-${c.connectorId}`}>
                      <td>{u.email}</td>
                      <td>{c.institutionName || c.institution}</td>
                      <td>
                        {c.connected ? (
                          <span className="pill pill-ok">Connected</span>
                        ) : (
                          <span className="pill">Not linked</span>
                        )}
                      </td>
                      <td className="num mono">
                        {c.connected ? (c.accountCount ?? '—') : '—'}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>What this does</h2>
        <ul className="plain-list">
          <li>
            Generic bank catalog (BoA, Chase, Vanguard) — each connection is
            owned by the signed-in email.
          </li>
          <li>
            Jerome and Ngoc each get their own set: up to 2 BoA, 2 Chase, 2
            Vanguard Items.
          </li>
          <li>
            Tokens live in SSM under{' '}
            <code>/r2finance/connectors/&#123;userKey&#125;/&#123;bank&#125;</code>
            , never in git or the browser.
          </li>
          <li>
            <strong>Does not</strong> create or sync transactions into DynamoDB
            / the YNAB ledger yet.
          </li>
        </ul>
      </section>
    </div>
  );
}
