import { useEffect, useMemo, useState } from 'react';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import {
  buildSpendingReport,
  defaultPeriodKey,
  listMonths,
  listYears,
  type PeriodMode,
  type RankRow,
  type TrendPoint,
} from '../lib/analytics';
import { formatMoney, formatMonth, moneyClass } from '../lib/money';

type TabId =
  | 'overview'
  | 'categories'
  | 'groups'
  | 'payees'
  | 'accounts'
  | 'trends';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'categories', label: 'Categories' },
  { id: 'groups', label: 'Groups' },
  { id: 'payees', label: 'Payees' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'trends', label: 'Trends' },
];

function ShareBar({ share, negative = true }: { share: number; negative?: boolean }) {
  const pct = Math.min(100, Math.max(0, share * 100));
  return (
    <div className="share-track" aria-hidden>
      <div
        className={`share-fill ${negative ? 'share-neg' : 'share-pos'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function RankedPanel({
  title,
  rows,
  empty,
  showShare = true,
}: {
  title: string;
  rows: RankRow[];
  empty: string;
  showShare?: boolean;
}) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="ranked-list ranked-with-share">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="rank-main">
                <span className="rank-name">{r.name}</span>
                <span className={`mono ${moneyClass(r.amount)}`}>
                  {formatMoney(r.amount)}
                </span>
              </div>
              {showShare && r.share > 0 && (
                <div className="rank-share-row">
                  <ShareBar share={r.share} />
                  <span className="muted small mono">
                    {(r.share * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TrendBars({
  points,
  mode,
}: {
  points: TrendPoint[];
  mode: 'outflow' | 'both';
}) {
  if (points.length === 0) {
    return <p className="muted">No activity in this period.</p>;
  }
  const max = Math.max(
    ...points.map((p) =>
      mode === 'both'
        ? Math.max(p.inflow, Math.abs(p.outflow))
        : Math.abs(p.outflow),
    ),
    1,
  );

  return (
    <div className={`bars bars-${mode === 'both' ? 'dual' : 'single'}`}>
      {points.map((p) => (
        <div key={p.key} className="bar-col" title={tooltip(p)}>
          <div className="bar-track bar-track-dual">
            {mode === 'both' && (
              <div
                className="bar bar-in"
                style={{ height: `${(p.inflow / max) * 100}%` }}
              />
            )}
            <div
              className="bar bar-out"
              style={{ height: `${(Math.abs(p.outflow) / max) * 100}%` }}
            />
          </div>
          <div className="bar-label">
            {p.key.length === 7 ? p.key.slice(5) : p.key.slice(2)}
          </div>
          <div className="bar-sub muted mono">
            {formatMoney(p.outflow)}
          </div>
        </div>
      ))}
    </div>
  );
}

function tooltip(p: TrendPoint): string {
  return `${p.label}\nIn ${formatMoney(p.inflow)}\nOut ${formatMoney(p.outflow)}\nNet ${formatMoney(p.net)}`;
}

export function ReportsPage() {
  const { data, loading, error, refresh } = useLedger();
  const [mode, setMode] = useState<PeriodMode>('month');
  const [periodKey, setPeriodKey] = useState('');
  const [tab, setTab] = useState<TabId>('overview');

  const months = useMemo(
    () => (data ? listMonths(data.transactions) : []),
    [data],
  );
  const years = useMemo(
    () => (data ? listYears(data.transactions) : []),
    [data],
  );

  useEffect(() => {
    if (!data) return;
    setPeriodKey((prev) => {
      if (mode === 'all') return 'all';
      if (mode === 'year') {
        if (prev && years.includes(prev)) return prev;
        return defaultPeriodKey('year', data.transactions);
      }
      if (prev && months.includes(prev)) return prev;
      return defaultPeriodKey('month', data.transactions);
    });
  }, [data, mode, months, years]);

  const report = useMemo(() => {
    if (!data || !periodKey) return null;
    return buildSpendingReport({
      transactions: data.transactions,
      categories: data.categories,
      groups: data.groups,
      payees: data.payees,
      accounts: data.accounts,
      mode,
      periodKey,
    });
  }, [data, mode, periodKey]);

  if (loading && !data) return <Loading />;
  if (error && !data)
    return <ErrorPanel message={error} onRetry={() => void refresh()} />;
  if (!data || !report) return <Loading />;

  const trendForOverview =
    mode === 'month'
      ? // show last 6 months ending at selected (or available)
        (() => {
          const all = listMonths(data.transactions).slice().reverse();
          const idx = all.indexOf(periodKey);
          const end = idx >= 0 ? idx + 1 : all.length;
          return all
            .slice(Math.max(0, end - 6), end)
            .map((ym) => {
              const r = buildSpendingReport({
                transactions: data.transactions,
                categories: data.categories,
                groups: data.groups,
                payees: data.payees,
                accounts: data.accounts,
                mode: 'month',
                periodKey: ym,
              });
              return {
                key: ym,
                label: formatMonth(ym),
                inflow: r.inflow,
                outflow: r.outflow,
                net: r.net,
                count: r.count,
              } satisfies TrendPoint;
            });
        })()
      : mode === 'year'
        ? report.monthlyTrend
        : report.yearlyTrend.length > 1
          ? report.yearlyTrend
          : report.monthlyTrend;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="muted">
            YNAB-style spending analytics · {report.periodLabel}
          </p>
        </div>
        <div className="report-controls">
          <div className="seg-control" role="group" aria-label="Period">
            {(
              [
                ['month', 'Month'],
                ['year', 'Year'],
                ['all', 'All time'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={mode === id ? 'seg is-active' : 'seg'}
                onClick={() => setMode(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === 'month' && (
            <select
              className="input report-period"
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m)}
                </option>
              ))}
            </select>
          )}
          {mode === 'year' && (
            <select
              className="input report-period"
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Inflow</div>
          <div className={`stat-value ${moneyClass(report.inflow)}`}>
            {formatMoney(report.inflow)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Outflow</div>
          <div className={`stat-value ${moneyClass(report.outflow)}`}>
            {formatMoney(report.outflow)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Net</div>
          <div className={`stat-value ${moneyClass(report.net)}`}>
            {formatMoney(report.net)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            {mode === 'month' ? 'Transactions' : 'Avg monthly out'}
          </div>
          <div className="stat-value">
            {mode === 'month'
              ? report.count
              : formatMoney(report.avgMonthlyOutflow)}
          </div>
          {mode !== 'month' && (
            <div className="muted small">
              {report.count.toLocaleString()} txns · {report.monthsCovered} mo
            </div>
          )}
        </div>
      </div>

      <div className="seg-control tabs-bar" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'seg is-active' : 'seg'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>
                {mode === 'all' && report.yearlyTrend.length > 1
                  ? 'Income vs expense by year'
                  : mode === 'year'
                    ? `Monthly spending · ${periodKey}`
                    : 'Recent months (outflow)'}
              </h2>
              <div className="legend">
                <span className="legend-item">
                  <i className="swatch swatch-out" /> Outflow
                </span>
                {(mode === 'year' || mode === 'all') && (
                  <span className="legend-item">
                    <i className="swatch swatch-in" /> Inflow
                  </span>
                )}
              </div>
            </div>
            <TrendBars
              points={trendForOverview}
              mode={mode === 'month' ? 'outflow' : 'both'}
            />
          </section>

          <div className="two-col">
            <RankedPanel
              title="Top categories"
              rows={report.byCategory.slice(0, 8)}
              empty="No spending in this period."
            />
            <RankedPanel
              title="Top payees"
              rows={report.byPayee.slice(0, 8)}
              empty="No payee spending in this period."
            />
          </div>
        </>
      )}

      {tab === 'categories' && (
        <RankedPanel
          title={`Spending by category · ${report.periodLabel}`}
          rows={report.byCategory}
          empty="No categorized spending in this period."
        />
      )}

      {tab === 'groups' && (
        <RankedPanel
          title={`Spending by category group · ${report.periodLabel}`}
          rows={report.byGroup}
          empty="No group spending in this period."
        />
      )}

      {tab === 'payees' && (
        <RankedPanel
          title={`Spending by payee · ${report.periodLabel}`}
          rows={report.byPayee}
          empty="No payee spending in this period."
        />
      )}

      {tab === 'accounts' && (
        <RankedPanel
          title={`Activity by account (net) · ${report.periodLabel}`}
          rows={report.byAccount}
          empty="No account activity in this period."
          showShare={false}
        />
      )}

      {tab === 'trends' && (
        <>
          <section className="panel">
            <h2>Monthly income vs expense</h2>
            <p className="muted small" style={{ marginTop: -8, marginBottom: 12 }}>
              {mode === 'month'
                ? 'Last months with activity (transfers excluded).'
                : mode === 'year'
                  ? `All months in ${periodKey}.`
                  : 'Every month with activity across the ledger.'}
            </p>
            <TrendBars
              points={
                mode === 'year'
                  ? report.monthlyTrend
                  : mode === 'all'
                    ? report.monthlyTrend.slice(-24)
                    : trendForOverview
              }
              mode="both"
            />
          </section>
          {report.yearlyTrend.length > 1 && (
            <section className="panel">
              <h2>Yearly totals</h2>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th className="num">Inflow</th>
                      <th className="num">Outflow</th>
                      <th className="num">Net</th>
                      <th className="num">Txns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...report.yearlyTrend].reverse().map((y) => (
                      <tr key={y.key}>
                        <td>{y.key}</td>
                        <td className={`num mono ${moneyClass(y.inflow)}`}>
                          {formatMoney(y.inflow)}
                        </td>
                        <td className={`num mono ${moneyClass(y.outflow)}`}>
                          {formatMoney(y.outflow)}
                        </td>
                        <td className={`num mono ${moneyClass(y.net)}`}>
                          {formatMoney(y.net)}
                        </td>
                        <td className="num mono">{y.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {mode === 'year' && report.monthlyTrend.length > 0 && (
            <section className="panel">
              <h2>Month-by-month table · {periodKey}</h2>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="num">Inflow</th>
                      <th className="num">Outflow</th>
                      <th className="num">Net</th>
                      <th className="num">Txns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...report.monthlyTrend].reverse().map((m) => (
                      <tr key={m.key}>
                        <td>{formatMonth(m.key)}</td>
                        <td className={`num mono ${moneyClass(m.inflow)}`}>
                          {formatMoney(m.inflow)}
                        </td>
                        <td className={`num mono ${moneyClass(m.outflow)}`}>
                          {formatMoney(m.outflow)}
                        </td>
                        <td className={`num mono ${moneyClass(m.net)}`}>
                          {formatMoney(m.net)}
                        </td>
                        <td className="num mono">{m.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
