import { useCallback, useEffect, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { connectorsApi, type BoaAccounts, type BoaStatus } from '../api/client';
import { ErrorPanel, Loading } from '../components/Loading';

function formatUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
  });
}

export function ConnectorsPage() {
  const [status, setStatus] = useState<BoaStatus | null>(null);
  const [accounts, setAccounts] = useState<BoaAccounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await connectorsApi.boaStatus();
      setStatus(s);
      if (s.connected) {
        try {
          const a = await connectorsApi.boaAccounts();
          setAccounts(a);
        } catch (e) {
          setAccounts(null);
          setMsg(
            `Connected, but live probe failed: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
      } else {
        setAccounts(null);
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
      if (!publicToken) {
        setMsg('Link returned no public token');
        setBusy(false);
        return;
      }
      setBusy(true);
      setMsg('Saving Bank of America connection…');
      try {
        const res = await connectorsApi.boaExchange(publicToken, metadata);
        setMsg(
          `Connected: ${res.institutionName} · ${res.accounts.length} account(s). Transactions are not written to the ledger yet.`,
        );
        setLinkToken(null);
        await load();
      } catch (e) {
        setMsg(
          `Exchange failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [load],
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

  // Resume OAuth return to /connectors?...oauth_state_id=...
  useEffect(() => {
    if (!oauthRedirect || linkToken || busy) return;
    void (async () => {
      setBusy(true);
      try {
        const { link_token } = await connectorsApi.boaLinkToken();
        setLinkToken(link_token);
      } catch (e) {
        setMsg(
          `OAuth resume failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        setBusy(false);
      }
    })();
  }, [oauthRedirect, linkToken, busy]);

  async function startConnect() {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const { link_token } = await connectorsApi.boaLinkToken();
      setLinkToken(link_token);
    } catch (e) {
      setMsg(
        `Could not start Link: ${e instanceof Error ? e.message : String(e)}`,
      );
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect Bank of America from R2Finance?')) return;
    setBusy(true);
    setMsg(null);
    try {
      await connectorsApi.boaDisconnect();
      setMsg('Disconnected.');
      await load();
    } catch (e) {
      setMsg(
        `Disconnect failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function refreshAccounts() {
    setBusy(true);
    setMsg(null);
    try {
      const a = await connectorsApi.boaAccounts();
      setAccounts(a);
      setMsg(`Probed ${a.accounts.length} account(s) live from Plaid.`);
    } catch (e) {
      setMsg(`Probe failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !status) return <Loading />;
  if (error && !status)
    return <ErrorPanel message={error} onRetry={() => void load()} />;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Connectors</h1>
          <p className="muted">
            Bank links for credit-card spend tracking. Access only for now —
            nothing is written to the DDB ledger.
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

      <section className="panel connector-card">
        <div className="connector-head">
          <div className="connector-logo" aria-hidden>
            BoA
          </div>
          <div>
            <h2>Bank of America</h2>
            <p className="muted small">
              Plaid Link · credit cards &amp; deposits · read-only
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
            <dt>Provider</dt>
            <dd>{status?.provider || 'plaid'}</dd>
          </div>
          <div>
            <dt>Institution</dt>
            <dd>{status?.institutionName || 'Bank of America'}</dd>
          </div>
          <div>
            <dt>Plaid configured</dt>
            <dd>{status?.configured ? 'Yes' : 'No'}</dd>
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

        {!status?.configured && (
          <div className="alert alert-info">
            <p>
              <strong>Setup required:</strong> add Plaid API keys to AWS Secrets
              Manager secret <code>R2Finance/plaid</code>:
            </p>
            <pre className="sync-log">{`{
  "client_id": "…",
  "secret": "…",
  "env": "sandbox"
}`}</pre>
            <p className="muted small">
              Register OAuth redirect{' '}
              <code>https://finance.i-liquid.be/connectors</code> in the Plaid
              dashboard. Use <code>development</code> or{' '}
              <code>production</code> for your real BoA login.
            </p>
          </div>
        )}

        <div className="btn-row">
          {!status?.connected ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !status?.configured}
              onClick={() => void startConnect()}
            >
              Connect Bank of America
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void refreshAccounts()}
              >
                Probe accounts
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void startConnect()}
              >
                Reconnect
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => void disconnect()}
              >
                Disconnect
              </button>
            </>
          )}
        </div>
        {msg && <pre className="sync-log">{msg}</pre>}
      </section>

      {accounts && accounts.accounts.length > 0 && (
        <section className="panel">
          <h2>Live accounts (Plaid)</h2>
          <p className="muted small">
            Source: {accounts.source} · not stored as ledger transactions
          </p>
          <div className="table-wrap">
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
                    <td className="mono">{a.mask ? `••••${a.mask}` : '—'}</td>
                    <td className="num mono">
                      {formatUsd(a.balances.available)}
                    </td>
                    <td className="num mono">
                      {formatUsd(a.balances.current)}
                    </td>
                    <td className="num mono">{formatUsd(a.balances.limit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>What this does</h2>
        <ul className="plain-list">
          <li>
            Opens Plaid Link so you can sign in to <strong>Bank of America</strong>{' '}
            (OAuth) and grant read access.
          </li>
          <li>
            Stores the Plaid <code>access_token</code> in Secrets Manager (
            <code>R2Finance/connectors/boa</code>), never in the browser.
          </li>
          <li>
            Lets you probe live balances/accounts to confirm access works.
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
