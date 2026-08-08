import { useMemo, useState } from 'react';
import { API_BASE, getEmail, ledgerApi } from '../api/client';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import {
  buildTxnInflux,
  buildYnabOutbound,
  type InfluxDay,
  type InfluxSeries,
  type OutboundDay,
  type OutboundSeries,
} from '../lib/txnInflux';

/** Stacked bars: which API path brought the row into the ledger. */
const YNAB_COLOR = '#6c8cff';
const R2_COLOR = '#3dcc91';
/** Outbound: successful writes from R2Finance → YNAB */
const OUTBOUND_COLOR = '#f0a030';
const PENDING_COLOR = '#e85d5d';

export function MorePage() {
  const { data, loading, error, refresh } = useLedger();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState<InfluxDay | null>(null);
  const [outHover, setOutHover] = useState<OutboundDay | null>(null);

  const influx = useMemo(
    () => (data ? buildTxnInflux(data.transactions, { days: 90 }) : null),
    [data],
  );
  const outbound = useMemo(
    () => (data ? buildYnabOutbound(data.transactions, { days: 90 }) : null),
    [data],
  );

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

      {influx && (
        <TxnInfluxPanel
          series={influx}
          hover={hover}
          onHover={setHover}
        />
      )}

      {outbound && (
        <YnabOutboundPanel
          series={outbound}
          hover={outHover}
          onHover={setOutHover}
        />
      )}

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

/**
 * 90-day histogram of *how many* ledger rows arrived per day, by origin
 * (YNAB pull vs R2-created). This is intake only — not category push to YNAB.
 */
function TxnInfluxPanel({
  series,
  hover,
  onHover,
}: {
  series: InfluxSeries;
  hover: InfluxDay | null;
  onHover: (d: InfluxDay | null) => void;
}) {
  const { totals, buckets, from, to } = series;
  const active = hover || null;

  const max = useMemo(() => {
    let m = 1;
    for (const b of buckets) {
      m = Math.max(m, b.ynabCount, b.r2Count, b.totalCount);
    }
    return m;
  }, [buckets]);

  const mid = buckets[Math.floor(buckets.length / 2)];
  const peak = useMemo(() => {
    let best: InfluxDay | null = null;
    for (const b of buckets) {
      if (!best || b.totalCount > best.totalCount) best = b;
    }
    return best && best.totalCount > 0 ? best : null;
  }, [buckets]);

  const ynabPct =
    totals.totalCount > 0
      ? Math.round((100 * totals.ynabCount) / totals.totalCount)
      : 0;
  const r2Pct = totals.totalCount > 0 ? 100 - ynabPct : 0;

  return (
    <section className="panel influx-panel">
      <div className="panel-head influx-head">
        <div>
          <h2>Transaction influx · 90 days</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Where rows <strong>entered</strong> the ledger (not YNAB outbound) ·{' '}
            {formatShortRange(from, to)}
          </p>
        </div>
      </div>

      <div className="influx-stats">
        <div className="influx-stat">
          <div className="stat-label">From YNAB</div>
          <div className="stat-value mono" style={{ color: YNAB_COLOR }}>
            {totals.ynabCount.toLocaleString()}
          </div>
          <div className="muted small mono" style={{ marginTop: 4 }}>
            {ynabPct}% of intake
          </div>
        </div>
        <div className="influx-stat">
          <div className="stat-label">Created in R2</div>
          <div className="stat-value mono" style={{ color: R2_COLOR }}>
            {totals.r2Count.toLocaleString()}
          </div>
          <div className="muted small mono" style={{ marginTop: 4 }}>
            {r2Pct}% of intake
          </div>
        </div>
        <div className="influx-stat">
          <div className="stat-label">Total rows</div>
          <div className="stat-value mono">
            {totals.totalCount.toLocaleString()}
          </div>
          <div className="muted small mono" style={{ marginTop: 4 }}>
            ~{(totals.totalCount / Math.max(1, series.days)).toFixed(1)}/day
          </div>
        </div>
        <div className="influx-stat">
          <div className="stat-label">Peak day</div>
          <div className="stat-value mono">
            {peak ? peak.totalCount.toLocaleString() : '—'}
          </div>
          <div className="muted small mono" style={{ marginTop: 4 }}>
            {peak ? peak.label : '—'}
          </div>
        </div>
      </div>

      <div className="influx-legend">
        <span className="legend-item">
          <i className="swatch" style={{ background: YNAB_COLOR }} /> From YNAB
        </span>
        <span className="legend-item">
          <i className="swatch" style={{ background: R2_COLOR }} /> Created in R2
        </span>
        {active && (
          <span className="influx-hover-chip mono small">
            {active.fullLabel}
            {` · YNAB ${active.ynabCount} · R2 ${active.r2Count} · ${active.totalCount} total`}
          </span>
        )}
      </div>

      {totals.totalCount === 0 ? (
        <p className="muted">No transactions in the past 90 days.</p>
      ) : (
        <>
          <div
            className="hist-90"
            role="img"
            aria-label="Daily histogram of YNAB vs R2Finance transaction intake counts over 90 days"
            onMouseLeave={() => onHover(null)}
          >
            {buckets.map((b) => {
              const a = b.ynabCount;
              const c = b.r2Count;
              const hA = Math.max(a > 0 ? 3 : 0, (a / max) * 100);
              const hC = Math.max(c > 0 ? 3 : 0, (c / max) * 100);
              const title = `${b.fullLabel}\nFrom YNAB: ${b.ynabCount}\nCreated in R2: ${b.r2Count}\n${b.totalCount} total`;

              return (
                <div
                  key={b.key}
                  className={`hist-col${hover?.key === b.key ? ' is-hover' : ''}`}
                  title={title}
                  onMouseEnter={() => onHover(b)}
                >
                  <div className="hist-track">
                    <div
                      className="hist-bar"
                      style={{ height: `${hA}%`, background: YNAB_COLOR }}
                    />
                    <div
                      className="hist-bar"
                      style={{ height: `${hC}%`, background: R2_COLOR }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="hist-axis">
            <span>{buckets[0]?.label}</span>
            <span>{mid?.label}</span>
            <span>{buckets[buckets.length - 1]?.label}</span>
          </div>
        </>
      )}

      <p className="muted small" style={{ marginBottom: 0, marginTop: 12 }}>
        Intake only. Categorizing a YNAB-imported row does <strong>not</strong>{' '}
        move it into “Created in R2” — that stays under “From YNAB”. Use{' '}
        <strong>Pushed to YNAB</strong> below for category/approve outbound.
      </p>
    </section>
  );
}

/**
 * Outbound bridge: successful writes R2Finance → YNAB (by lastPushedAt day).
 * This is what you want after categorizing on the website.
 */
function YnabOutboundPanel({
  series,
  hover,
  onHover,
}: {
  series: OutboundSeries;
  hover: OutboundDay | null;
  onHover: (d: OutboundDay | null) => void;
}) {
  const { totals, buckets, from, to } = series;
  const mid = buckets[Math.floor(buckets.length / 2)];

  const max = useMemo(() => {
    let m = 1;
    for (const b of buckets) m = Math.max(m, b.count);
    return m;
  }, [buckets]);

  const peak = useMemo(() => {
    let best: OutboundDay | null = null;
    for (const b of buckets) {
      if (!best || b.count > best.count) best = b;
    }
    return best && best.count > 0 ? best : null;
  }, [buckets]);

  return (
    <section className="panel influx-panel">
      <div className="panel-head influx-head">
        <div>
          <h2>Pushed to YNAB · 90 days</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Category / approve / create that landed in YNAB · by push day ·{' '}
            {formatShortRange(from, to)}
          </p>
        </div>
      </div>

      <div className="influx-stats">
        <div className="influx-stat">
          <div className="stat-label">Pushed (90d)</div>
          <div className="stat-value mono" style={{ color: OUTBOUND_COLOR }}>
            {totals.pushedCount.toLocaleString()}
          </div>
          <div className="muted small mono" style={{ marginTop: 4 }}>
            lastPushedAt in window
          </div>
        </div>
        <div className="influx-stat">
          <div className="stat-label">Pending queue</div>
          <div
            className="stat-value mono"
            style={{
              color: totals.pendingCount > 0 ? PENDING_COLOR : undefined,
            }}
          >
            {totals.pendingCount.toLocaleString()}
          </div>
          <div className="muted small mono" style={{ marginTop: 4 }}>
            waiting for YNAB
          </div>
        </div>
        <div className="influx-stat">
          <div className="stat-label">Ever pushed</div>
          <div className="stat-value mono">
            {totals.everPushedCount.toLocaleString()}
          </div>
          <div className="muted small mono" style={{ marginTop: 4 }}>
            any age
          </div>
        </div>
        <div className="influx-stat">
          <div className="stat-label">Peak day</div>
          <div className="stat-value mono">
            {peak ? peak.count.toLocaleString() : '—'}
          </div>
          <div className="muted small mono" style={{ marginTop: 4 }}>
            {peak ? peak.label : '—'}
          </div>
        </div>
      </div>

      <div className="influx-legend">
        <span className="legend-item">
          <i className="swatch" style={{ background: OUTBOUND_COLOR }} />{' '}
          Successful push to YNAB
        </span>
        {hover && (
          <span className="influx-hover-chip mono small">
            {hover.fullLabel}
            {` · ${hover.count} pushed`}
          </span>
        )}
      </div>

      {totals.pushedCount === 0 ? (
        <p className="muted">
          No stamped outbound pushes in this window yet. After you categorize
          (wait ~10s for the undo bar, or leave the tab open until it commits),
          reloads here should show a bar. Pending queue right now:{' '}
          <strong className="mono">{totals.pendingCount}</strong>
          {totals.pendingCount === 0
            ? ' — nothing stuck; if YNAB didn’t update, the categorize API may not have been called (undo window cancelled or tab closed early).'
            : ' — use “Server push from DDB” below to drain.'}
        </p>
      ) : (
        <>
          <div
            className="hist-90"
            role="img"
            aria-label="Daily histogram of successful pushes from R2Finance to YNAB"
            onMouseLeave={() => onHover(null)}
          >
            {buckets.map((b) => {
              const h = Math.max(b.count > 0 ? 3 : 0, (b.count / max) * 100);
              return (
                <div
                  key={b.key}
                  className={`hist-col${hover?.key === b.key ? ' is-hover' : ''}`}
                  title={`${b.fullLabel}\nPushed to YNAB: ${b.count}`}
                  onMouseEnter={() => onHover(b)}
                >
                  <div className="hist-track">
                    <div
                      className="hist-bar"
                      style={{ height: `${h}%`, background: OUTBOUND_COLOR }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="hist-axis">
            <span>{buckets[0]?.label}</span>
            <span>{mid?.label}</span>
            <span>{buckets[buckets.length - 1]?.label}</span>
          </div>
        </>
      )}

      <p className="muted small" style={{ marginBottom: 0, marginTop: 12 }}>
        Tracking starts when the backend stamps <code>lastPushedAt</code> on a
        successful YNAB write (category, approve, or device create). Older
        successful pushes before that stamp won’t appear.
      </p>
    </section>
  );
}

function formatShortRange(from: string, to: string): string {
  const f = new Date(from + 'T12:00:00');
  const t = new Date(to + 'T12:00:00');
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
  };
  const sameYear = f.getFullYear() === t.getFullYear();
  return `${f.toLocaleDateString(undefined, {
    ...opts,
    year: sameYear ? undefined : 'numeric',
  })} – ${t.toLocaleDateString(undefined, { ...opts, year: 'numeric' })}`;
}
