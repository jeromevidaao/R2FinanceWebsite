import { useMemo, useState } from 'react';
import { CategorizeModal } from '../components/CategorizeModal';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import { formatMoney, moneyClass } from '../lib/money';
import {
  isInboxTxn,
  resolveCategory,
  resolvePayee,
} from '../lib/dataStore';
import type { Transaction } from '../api/types';

export function InboxPage() {
  const { data, loading, error, refresh } = useLedger();
  const [target, setTarget] = useState<Transaction | null>(null);

  const items = useMemo(() => {
    if (!data) return [];
    return data.transactions.filter((t) => isInboxTxn(t, data));
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error && !data)
    return <ErrorPanel message={error} onRetry={() => void refresh()} />;
  if (!data) return <Loading />;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Inbox</h1>
          <p className="muted">
            Uncategorized or unapproved transactions · {items.length} items
          </p>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="panel empty">
          <h2>All clear ✨</h2>
          <p className="muted">
            No transactions need categorization or approval.
          </p>
        </div>
      ) : (
        <ul className="inbox-list panel">
          {items.map((t) => {
            const acct = data.accounts.find((a) => a.ynabId === t.accountId);
            return (
              <li key={t.ynabId} className="inbox-row">
                <div className="inbox-main">
                  <div className="row-title">
                    {resolvePayee(data, t.payeeId)}
                  </div>
                  <div className="muted small">
                    {acct?.name || 'Account'} · {t.date} ·{' '}
                    {resolveCategory(data, t.categoryId, t)}
                    {!t.approved ? ' · needs approval' : ''}
                  </div>
                  {t.memo && <div className="muted small">{t.memo}</div>}
                </div>
                <div className={`mono ${moneyClass(t.amount)}`}>
                  {formatMoney(t.amount)}
                </div>
                {!t.transferAccountId && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setTarget(t)}
                  >
                    {t.categoryId ? 'Edit category' : 'Categorize'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {target && (
        <CategorizeModal
          data={data}
          txn={target}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}
