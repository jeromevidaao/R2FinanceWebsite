import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import {
  buildSpendingReport,
  currentMonthKey,
  incomeVsSpendingInsight,
  lastNMonthKeys,
  type TrendPoint,
} from '../lib/analytics';
import {
  INCOME_COLOR,
  SPENDING_COLOR,
  buildStackSegments,
} from '../lib/categoryColors';
import { formatMoney, formatMonth, formatSpend, moneyClass } from '../lib/money';

export function ReportsPage() {
  const { data, loading, error, refresh } = useLedger();

  const monthKey = useMemo(() => currentMonthKey(), []);

  const report = useMemo(() => {
    if (!data) return null;
    // Prefer current calendar month; fall back to latest month with data
    const months = data.transactions
      .filter((t) => !t.transferAccountId)
      .map((t) => t.date.slice(0, 7));
    const hasCurrent = months.includes(monthKey);
    const key =
      hasCurrent || months.length === 0
        ? monthKey
        : [...new Set(months)].sort().reverse()[0];
    return buildSpendingReport({
      transactions: data.transactions,
      categories: data.categories,
      groups: data.groups,
      payees: data.payees,
      accounts: data.accounts,
      mode: 'month',
      periodKey: key,
    });
  }, [data, monthKey]);

  const colorById = useMemo(() => {
    const m = new Map<string, string>();
    if (!data) return m;
    for (const c of data.categories) {
      if (c.color) m.set(c.ynabId, c.color);
    }
    return m;
  }, [data]);

  const stack = useMemo(() => {
    if (!report) return { segments: [], totalAbs: 0 };
    return buildStackSegments(report.byCategory, colorById, 5);
  }, [report, colorById]);

  const incomeTrend = useMemo((): TrendPoint[] => {
    if (!data || !report) return [];
    const keys = lastNMonthKeys(report.periodKey, 6);
    return keys.map((ym) => {
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
      };
    });
  }, [data, report]);

  const insight = useMemo(
    () => incomeVsSpendingInsight(incomeTrend),
    [incomeTrend],
  );

  if (loading && !data) return <Loading />;
  if (error && !data)
    return <ErrorPanel message={error} onRetry={() => void refresh()} />;
  if (!data || !report) return <Loading />;

  const spendingAbs = Math.abs(report.outflow);

  return (
    <div className="page reflect-page">
      <header className="page-header">
        <div>
          <h1>Reflect</h1>
          <p className="muted">
            How money was spent · income vs spending · {report.periodLabel}
          </p>
        </div>
      </header>

      {/* Spending Breakdown card */}
      <Link to="/reports/spending" className="reflect-card-link">
        <section className="panel reflect-card">
          <div className="panel-head">
            <div>
              <h2>Spending Breakdown</h2>
              <p className="muted small" style={{ margin: 0 }}>
                {report.periodLabel}
              </p>
            </div>
            <span className="reflect-arrow" aria-hidden>
              →
            </span>
          </div>

          <div className="reflect-total mono">
            {formatSpend(report.outflow)}
          </div>
          <p className="muted small" style={{ marginTop: 0 }}>
            Total spending
          </p>

          {stack.segments.length > 0 ? (
            <>
              <div
                className="stack-bar"
                role="img"
                aria-label="Spending by category"
              >
                {stack.segments.map((s) => (
                  <div
                    key={s.id}
                    className="stack-seg"
                    style={{
                      width: `${Math.max(s.share * 100, 0.5)}%`,
                      background: s.color,
                    }}
                    title={`${s.name}: ${formatMoney(s.amount)}`}
                  />
                ))}
              </div>

              <ul className="reflect-cat-list">
                {stack.segments.map((s) => (
                  <li key={s.id}>
                    <span className="cat-dot" style={{ background: s.color }} />
                    <span className="cat-name">
                      {s.id === '__others' ? 'All Others' : s.name}
                    </span>
                    <span className={`mono ${moneyClass(s.amount)}`}>
                      {formatMoney(s.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">No spending in this period.</p>
          )}

          <div className="reflect-card-foot muted small">
            Tap for Month / Presets detail · full category list
          </div>
        </section>
      </Link>

      {/* Income vs Spending card */}
      <section className="panel reflect-card">
        <div className="panel-head">
          <h2>Income vs Spending</h2>
          <div className="legend">
            <span className="legend-item">
              <i className="swatch" style={{ background: INCOME_COLOR }} />{' '}
              Income
            </span>
            <span className="legend-item">
              <i className="swatch" style={{ background: SPENDING_COLOR }} />{' '}
              Spending
            </span>
          </div>
        </div>

        <p className="reflect-insight">{insight}</p>

        <IncomeSpendingBars points={incomeTrend} />

        {spendingAbs > 0 && (
          <p className="muted small" style={{ marginBottom: 0 }}>
            Current month outflow {formatMoney(report.outflow)} · inflow{' '}
            {formatMoney(report.inflow)}
          </p>
        )}
      </section>
    </div>
  );
}

function IncomeSpendingBars({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return <p className="muted">No activity in recent months.</p>;
  }
  const max = Math.max(
    ...points.map((p) => Math.max(p.inflow, Math.abs(p.outflow))),
    1,
  );

  return (
    <div className="bars bars-dual income-spend-bars">
      {points.map((p) => (
        <div
          key={p.key}
          className="bar-col"
          title={`${p.label}\nIncome ${formatMoney(p.inflow)}\nSpending ${formatMoney(p.outflow)}`}
        >
          <div className="bar-track bar-track-dual">
            <div
              className="bar bar-income"
              style={{
                height: `${(p.inflow / max) * 100}%`,
                background: INCOME_COLOR,
              }}
            />
            <div
              className="bar bar-spend"
              style={{
                height: `${(Math.abs(p.outflow) / max) * 100}%`,
                background: SPENDING_COLOR,
              }}
            />
          </div>
          <div className="bar-label">
            {p.key.length === 7 ? p.key.slice(5) : p.key.slice(2)}
          </div>
        </div>
      ))}
    </div>
  );
}

