import { useMemo, useState } from 'react';
import { API_BASE, getEmail, ledgerApi } from '../api/client';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import {
  buildTxnInflux,
  type InfluxDay,
  type InfluxSeries,
} from '../lib/txnInflux';
import { formatMoney, moneyClass } from '../lib/money';

type ChartMode = 'direction' | 'source';
type ChartMetric = 'amount' | 'count';

const IN_COLOR = '#3dcc91';
const OUT_COLOR = '#ff8a96';
const YNAB_COLOR = '#6c8cff';
const R2_COLOR = '#3dcc91';

export function MorePage() {
  const { data, loading, error, refresh } = useLedger();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ChartMode>('direction');
  const [metric, setMetric] = useState<ChartMetric>('amount');
  const [hover, setHover] = useState<InfluxDay | null>(null);

  const influx = useMemo(
    () => (data ? buildTxnInflux(data.transactions, { days: 90 }) : null),
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

  const currency = data.plan.currency || 'USD';

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
          currency={currency}
          mode={mode}
          metric={metric}
          hover={hover}
          onMode={setMode}
          onMetric={setMetric}
          onHover={setHover}
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

function TxnInfluxPanel({
  series,
  currency,
  mode,
  metric,
  hover,
  onMode,
  onMetric,
  onHover,
}: {
  series: InfluxSeries;
  currency: string;
  mode: ChartMode;
  metric: ChartMetric;
  hover: InfluxDay | null;
  onMode: (m: ChartMode) => void;
  onMetric: (m: ChartMetric) => void;
  onHover: (d: InfluxDay | null) => void;
}) {
  const { totals, buckets, from, to } = series;
  const active = hover || null;

  const max = useMemo(() => {
    let m = 1;
    for (const b of buckets) {
      if (mode === 'direction') {
        if (metric === 'amount') {
          m = Math.max(m, b.inflow, Math.abs(b.outflow));
        } else {
          m = Math.max(m, b.inCount, b.outCount);
        }
      } else if (metric === 'amount') {
        m = Math.max(m, b.ynabAmount, b.r2Amount);
      } else {
        m = Math.max(m, b.ynabCount, b.r2Count);
      }
    }
    return m;
  }, [buckets, mode, metric]);

  const mid = buckets[Math.floor(buckets.length / 2)];

  return (
    <section className="panel influx-panel">
      <div className="panel-head influx-head">
        <div>
          <h2>Transaction influx · 90 days</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Daily histogram of ledger activity from YNAB + R2Finance ·{' '}
            {formatShortRange(from, to)}
          </p>
        </div>
        <div className="report-controls">
          <div className="seg-control" role="group" aria-label="Chart series">
            <button
              type="button"
              className={mode === 'direction' ? 'seg is-active' : 'seg'}
              onClick={() => onMode('direction')}
            >
              In / Out
            </button>
            <button
              type="button"
              className={mode === 'source' ? 'seg is-active' : 'seg'}
              onClick={() => onMode('source')}
            >
              YNAB / R2
            </button>
          </div>
          <div className="seg-control" role="group" aria-label="Metric">
            <button
              type="button"
              className={metric === 'amount' ? 'seg is-active' : 'seg'}
              onClick={() => onMetric('amount')}
            >
              $
            </button>
            <button
              type="button"
              className={metric === 'count' ? 'seg is-active' : 'seg'}
              onClick={() => onMetric('count')}
            >
              #
            </button>
          </div>
        </div>
      </div>

      <div className="influx-stats">
        <div className="influx-stat">
          <div className="stat-label">Coming in</div>
          <div className={`stat-value mono ${moneyClass(totals.inflow)}`}>
            {metric === 'amount'
              ? formatMoney(totals.inflow, currency, { sign: true })
              : totals.inCount.toLocaleString()}
          </div>
        </div>
        <div className="influx-stat">
          <div className="stat-label">Going out</div>
          <div className={`stat-value mono ${moneyClass(totals.outflow)}`}>
            {metric === 'amount'
              ? formatMoney(totals.outflow, currency)
              : totals.outCount.toLocaleString()}
          </div>
        </div>
        <div className="influx-stat">
          <div className="stat-label">Net</div>
          <div className={`stat-value mono ${moneyClass(totals.net)}`}>
            {formatMoney(totals.net, currency, { sign: true })}
          </div>
        </div>
        <div className="influx-stat">
          <div className="stat-label">Transactions</div>
          <div className="stat-value mono">
            {totals.totalCount.toLocaleString()}
          </div>
          <div className="muted small mono" style={{ marginTop: 4 }}>
            YNAB {totals.ynabCount.toLocaleString()} · R2{' '}
            {totals.r2Count.toLocaleString()}
          </div>
        </div>
      </div>

      <div className="influx-legend">
        {mode === 'direction' ? (
          <>
            <span className="legend-item">
              <i className="swatch" style={{ background: IN_COLOR }} /> Coming in
            </span>
            <span className="legend-item">
              <i className="swatch" style={{ background: OUT_COLOR }} /> Going out
            </span>
          </>
        ) : (
          <>
            <span className="legend-item">
              <i className="swatch" style={{ background: YNAB_COLOR }} /> YNAB
            </span>
            <span className="legend-item">
              <i className="swatch" style={{ background: R2_COLOR }} /> R2Finance
            </span>
          </>
        )}
        {active && (
          <span className="influx-hover-chip mono small">
            {active.fullLabel}
            {mode === 'direction'
              ? metric === 'amount'
                ? ` · in ${formatMoney(active.inflow, currency, { sign: true })} · out ${formatMoney(active.outflow, currency)}`
                : ` · in ${active.inCount} · out ${active.outCount}`
              : metric === 'amount'
                ? ` · YNAB ${formatMoney(active.ynabAmount, currency)} · R2 ${formatMoney(active.r2Amount, currency)}`
                : ` · YNAB ${active.ynabCount} · R2 ${active.r2Count}`}
            {` · ${active.totalCount} txn${active.totalCount === 1 ? '' : 's'}`}
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
            aria-label={
              mode === 'direction'
                ? 'Daily histogram of money coming in and going out over 90 days'
                : 'Daily histogram of YNAB vs R2Finance transactions over 90 days'
            }
            onMouseLeave={() => onHover(null)}
          >
            {buckets.map((b) => {
              const a =
                mode === 'direction'
                  ? metric === 'amount'
                    ? b.inflow
                    : b.inCount
                  : metric === 'amount'
                    ? b.ynabAmount
                    : b.ynabCount;
              const c =
                mode === 'direction'
                  ? metric === 'amount'
                    ? Math.abs(b.outflow)
                    : b.outCount
                  : metric === 'amount'
                    ? b.r2Amount
                    : b.r2Count;
              const hA = Math.max(a > 0 ? 3 : 0, (a / max) * 100);
              const hC = Math.max(c > 0 ? 3 : 0, (c / max) * 100);
              const colorA = mode === 'direction' ? IN_COLOR : YNAB_COLOR;
              const colorC = mode === 'direction' ? OUT_COLOR : R2_COLOR;
              const title =
                mode === 'direction'
                  ? `${b.fullLabel}\nComing in: ${
                      metric === 'amount'
                        ? formatMoney(b.inflow, currency, { sign: true })
                        : b.inCount
                    }\nGoing out: ${
                      metric === 'amount'
                        ? formatMoney(b.outflow, currency)
                        : b.outCount
                    }\n${b.totalCount} transactions`
                  : `${b.fullLabel}\nYNAB volume: ${
                      metric === 'amount'
                        ? formatMoney(b.ynabAmount, currency)
                        : b.ynabCount
                    }\nR2Finance volume: ${
                      metric === 'amount'
                        ? formatMoney(b.r2Amount, currency)
                        : b.r2Count
                    }\n${b.totalCount} transactions`;

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
                      style={{ height: `${hA}%`, background: colorA }}
                    />
                    <div
                      className="hist-bar"
                      style={{ height: `${hC}%`, background: colorC }}
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
        <strong>Coming in / going out</strong> uses the transaction amount sign.
        <strong> YNAB</strong> = rows pulled from the YNAB bridge (no device{' '}
        <code>clientId</code>). <strong>R2Finance</strong> = rows created or
        edited via the app/device push path.
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
