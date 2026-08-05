import { useMemo, useState } from 'react';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import { formatMoney, moneyClass, monthKey } from '../lib/money';

export function CategoriesPage() {
  const { data, loading, error, refresh } = useLedger();
  const [q, setQ] = useState('');
  const thisMonth = monthKey(new Date().toISOString().slice(0, 10));

  const spendByCat = useMemo(() => {
    const map = new Map<string, number>();
    if (!data) return map;
    for (const t of data.transactions) {
      if (monthKey(t.date) !== thisMonth) continue;
      if (t.amount >= 0 || t.transferAccountId || !t.categoryId) continue;
      map.set(t.categoryId, (map.get(t.categoryId) || 0) + t.amount);
    }
    return map;
  }, [data, thisMonth]);

  const sections = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.groups
      .filter((g) => !g.hidden)
      .map((g) => {
        const cats = data.categories.filter(
          (c) =>
            !c.hidden &&
            c.categoryGroupId === g.ynabId &&
            (!needle ||
              c.name.toLowerCase().includes(needle) ||
              g.name.toLowerCase().includes(needle)),
        );
        return { group: g, cats };
      })
      .filter((s) => s.cats.length > 0);
  }, [data, q]);

  if (loading && !data) return <Loading />;
  if (error && !data)
    return <ErrorPanel message={error} onRetry={() => void refresh()} />;
  if (!data) return <Loading />;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Categories</h1>
          <p className="muted">
            {data.categories.length} categories · activity shown for{' '}
            {thisMonth}
          </p>
        </div>
      </header>

      <input
        className="input search"
        placeholder="Search categories…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {sections.map(({ group, cats }) => (
        <section key={group.ynabId} className="panel">
          <h2>{group.name}</h2>
          <ul className="ranked-list">
            {cats.map((c) => {
              const spent = spendByCat.get(c.ynabId) || 0;
              return (
                <li key={c.ynabId}>
                  <span>{c.name}</span>
                  <span className={`mono ${moneyClass(spent)}`}>
                    {spent ? formatMoney(spent) : '—'}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
