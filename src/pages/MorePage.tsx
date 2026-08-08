import { useState } from 'react';
import { API_BASE, getEmail, ledgerApi } from '../api/client';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';

export function MorePage() {
  const { data, loading, error, refresh } = useLedger();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setMsg(`${label}…`);
    try {
      const res = await fn();
      setMsg(`${label} done: ${JSON.stringify(res).slice(0, 280)}`);
      await refresh(true);
    } catch (e) {
      setMsg(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <Loading />;
  if (error && !data)
    return <ErrorPanel message={error} onRetry={() => void refresh()} />;
  if (!data) return <Loading />;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>More</h1>
          <p className="muted">Sync, plan info, and connection details</p>
        </div>
      </header>

      <section className="panel">
        <h2>Plan</h2>
        <dl className="kv">
          <div>
            <dt>Name</dt>
            <dd>{data.plan.name}</dd>
          </div>
          <div>
            <dt>Currency</dt>
            <dd>{data.plan.currency}</dd>
          </div>
          <div>
            <dt>Cloud plan id</dt>
            <dd className="mono small">{data.plan.ynabPlanId || '—'}</dd>
          </div>
          <div>
            <dt>Server knowledge</dt>
            <dd className="mono">{data.plan.serverKnowledge}</dd>
          </div>
          <div>
            <dt>Signed in</dt>
            <dd>{getEmail() || '—'}</dd>
          </div>
          <div>
            <dt>API</dt>
            <dd className="mono small break">{API_BASE}</dd>
          </div>
          <div>
            <dt>Loaded</dt>
            <dd>{new Date(data.loadedAt).toLocaleString()}</dd>
          </div>
        </dl>
      </section>

      {data.stats && (
        <section className="panel">
          <h2>Cloud stats</h2>
          <ul className="ranked-list">
            {Object.entries(data.stats.byType)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <li key={k}>
                  <span>{k}</span>
                  <span className="mono">{v.toLocaleString()}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2>Sync with R2Finance (cloud)</h2>
        <p className="muted">
          This website only talks to <strong>R2FinanceAPI + DynamoDB</strong> —
          never to YNAB. Admin buttons below can ask AWS Lambdas to run the
          backend bridge (DDB ↔ YNAB) using Secrets Manager on the server only.
        </p>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              void run('Cloud tick (server bridge + DDB)', () =>
                ledgerApi.syncTick(),
              )
            }
          >
            Sync cloud now
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void run('Server pull → DDB', () => ledgerApi.syncPull())}
          >
            Server pull → DDB
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void run('Server push from DDB', () => ledgerApi.syncPush())}
          >
            Server push from DDB
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() =>
              void run('Full server import → DDB', () => ledgerApi.syncImport())
            }
          >
            Full import → DDB
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void refresh(true)}
          >
            Reload from R2Finance
          </button>
        </div>
        {msg && <pre className="sync-log">{msg}</pre>}
      </section>

      <section className="panel">
        <h2>About</h2>
        <p>
          <strong>R2Finance</strong> is a multi-account spending register on{' '}
          <code>R2FinanceAPI</code> (DynamoDB + Lambda). The website and Android
          app only read/write the cloud ledger. Any two-way YNAB mirror runs
          entirely in AWS — not in the browser or phone.
        </p>
        <p className="muted small">
          Site: finance.i-liquid.be · Repo: R2FinanceWebsite
        </p>
      </section>
    </div>
  );
}
