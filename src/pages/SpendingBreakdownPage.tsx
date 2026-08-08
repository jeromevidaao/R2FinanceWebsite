import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import {
  PRESET_OPTIONS,
  buildSpendingReport,
  currentMonthKey,
  defaultPeriodKey,
  listMonths,
  type PeriodMode,
  type PresetId,
} from '../lib/analytics';
import {
  buildStackSegments,
  colorForCategoryId,
} from '../lib/categoryColors';
import { formatMoney, formatMonth, formatSpend, moneyClass } from '../lib/money';

type ViewMode = 'month' | 'presets';

export function SpendingBreakdownPage() {
  const { data, loading, error, refresh } = useLedger();
  const [view, setView] = useState<ViewMode>('month');
  const [monthKey, setMonthKey] = useState('');
  const [preset, setPreset] = useState<PresetId>('last3');

  const months = useMemo(
    () => (data ? listMonths(data.transactions) : []),
    [data],
  );

  useEffect(() => {
    if (!data) return;
    setMonthKey((prev) => {
      if (prev && months.includes(prev)) return prev;
      const cur = currentMonthKey();
      if (months.includes(cur)) return cur;
      return defaultPeriodKey('month', data.transactions);
    });
  }, [data, months]);

  const mode: PeriodMode = view === 'month' ? 'month' : 'preset';
  const periodKey = view === 'month' ? monthKey : preset;

  const colorById = useMemo(() => {
    const m = new Map<string, string>();
    if (!data) return m;
    for (const c of data.categories) {
      if (c.color) m.set(c.ynabId, c.color);
    }
    return m;
  }, [data]);

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

  const stack = useMemo(() => {
    if (!report) return { segments: [], totalAbs: 0 };
    // Full list bar: top 8 + others for readability
    return buildStackSegments(report.byCategory, colorById, 8);
  }, [report, colorById]);

  if (loading && !data) return <Loading />;
  if (error && !data)
    return <ErrorPanel message={error} onRetry={() => void refresh()} />;
  if (!data || !report) return <Loading />;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="muted small" style={{ margin: '0 0 4px' }}>
            <Link to="/reports" className="back-link">
              ← Reflect
            </Link>
          </p>
          <h1>Spending Breakdown</h1>
          <p className="muted">{report.periodLabel}</p>
        </div>
        <div className="report-controls">
          <div className="seg-control" role="group" aria-label="Range type">
            <button
              type="button"
              className={view === 'month' ? 'seg is-active' : 'seg'}
              onClick={() => setView('month')}
            >
              Month
            </button>
            <button
              type="button"
              className={view === 'presets' ? 'seg is-active' : 'seg'}
              onClick={() => setView('presets')}
            >
              Presets
            </button>
          </div>
          {view === 'month' ? (
            <select
              className="input report-period"
              value={monthKey}
              onChange={(e) => setMonthKey(e.target.value)}
              aria-label="Month"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m)}
                </option>
              ))}
            </select>
          ) : (
            <select
              className="input report-period"
              value={preset}
              onChange={(e) => setPreset(e.target.value as PresetId)}
              aria-label="Preset range"
            >
              {PRESET_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      <section className="panel">
        <div className="stat-label">Total Spending</div>
        <div className="reflect-total mono">
          {formatSpend(report.outflow)}
        </div>

        {stack.segments.length > 0 && (
          <div
            className="stack-bar stack-bar-lg"
            role="img"
            aria-label="Spending by category"
            style={{ marginTop: 16 }}
          >
            {stack.segments.map((s) => (
              <div
                key={s.id}
                className="stack-seg"
                style={{
                  width: `${Math.max(s.share * 100, 0.4)}%`,
                  background: s.color,
                }}
                title={`${s.name}: ${formatMoney(s.amount)} (${(s.share * 100).toFixed(0)}%)`}
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Categories</h2>
        {report.byCategory.length === 0 ? (
          <p className="muted">No spending in this period.</p>
        ) : (
          <ul className="breakdown-list">
            {report.byCategory.map((r) => {
              const color = colorForCategoryId(r.id, colorById, r.name);
              const pct = (r.share * 100).toFixed(r.share < 0.01 ? 1 : 0);
              return (
                <li key={r.id}>
                  <div className="breakdown-row-top">
                    <span className="cat-dot" style={{ background: color }} />
                    <span className="cat-name">{r.name}</span>
                    <span className={`mono ${moneyClass(r.amount)}`}>
                      {formatMoney(r.amount)}
                    </span>
                  </div>
                  <div className="breakdown-row-bar">
                    <div className="share-track">
                      <div
                        className="share-fill"
                        style={{
                          width: `${Math.min(100, r.share * 100)}%`,
                          background: color,
                        }}
                      />
                    </div>
                    <span className="muted small mono">{pct}%</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
