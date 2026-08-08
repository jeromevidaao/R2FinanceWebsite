import { useEffect, useState } from 'react';
import {
  getPendingCategorizes,
  pendingSecondsLeft,
  subscribePendingCategorize,
  subscribePendingCategorizeErrors,
  subscribePendingCategorizeSuccess,
  undoCategorize,
  undoLatestCategorize,
  type PendingCategorize,
} from '../lib/pendingCategorize';

/**
 * Floating bar after categorize: Undo (latest) or pick from a list when
 * several commits are still within the delay window.
 */
export function UndoCategorizeBar() {
  const [items, setItems] = useState<PendingCategorize[]>(() =>
    getPendingCategorizes(),
  );
  const [showList, setShowList] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    return subscribePendingCategorize(() => {
      setItems(getPendingCategorizes());
      setNow(Date.now());
    });
  }, []);

  useEffect(() => {
    return subscribePendingCategorizeErrors((msg) => {
      setSuccess(null);
      setError(msg);
    });
  }, []);

  useEffect(() => {
    return subscribePendingCategorizeSuccess((msg) => {
      setError(null);
      setSuccess(msg);
      window.setTimeout(() => setSuccess(null), 6000);
    });
  }, []);

  // Tick countdown while anything is pending.
  useEffect(() => {
    if (items.length === 0) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [items.length > 0]);

  useEffect(() => {
    if (items.length === 0) setShowList(false);
  }, [items.length]);

  if (items.length === 0 && !error && !success) return null;

  const latest = items[0];
  const multi = items.length > 1;
  const secs = latest ? pendingSecondsLeft(latest, now) : 0;

  return (
    <>
      {error && (
        <div className="undo-cat-bar undo-cat-bar--error" role="alert">
          <span className="undo-cat-msg">{error}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      {success && !error && (
        <div className="undo-cat-bar undo-cat-bar--ok" role="status">
          <span className="undo-cat-msg">{success}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setSuccess(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      {items.length > 0 && latest && (
        <div className="undo-cat-bar" role="status">
          <span className="undo-cat-msg">
            {multi
              ? `${items.length} pending · ${latest.label}`
              : `Categorized · ${latest.label}`}
            <span className="undo-cat-timer"> · YNAB in {secs}s</span>
          </span>
          <div className="undo-cat-actions">
            {multi && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowList(true)}
              >
                List
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => undoLatestCategorize()}
            >
              Undo
            </button>
          </div>
        </div>
      )}

      {showList && multi && (
        <div
          className="modal-backdrop"
          onClick={() => setShowList(false)}
        >
          <div
            className="modal undo-cat-list-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-head">
              <div>
                <h2>Pending categorizes</h2>
                <p className="muted">
                  Tap Undo on a row before it saves to the cloud.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowList(false)}
              >
                Close
              </button>
            </header>
            <ul className="undo-cat-list">
              {items.map((entry) => {
                const left = pendingSecondsLeft(entry, now);
                return (
                  <li key={entry.id} className="undo-cat-list-row">
                    <div>
                      <div className="undo-cat-list-label">{entry.label}</div>
                      <div className="muted small">
                        {entry.ynabIds.length === 1
                          ? '1 transaction'
                          : `${entry.ynabIds.length} transactions`}
                        {' · '}
                        saves in {left}s
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        undoCategorize(entry.id);
                        if (getPendingCategorizes().length <= 1) {
                          setShowList(false);
                        }
                      }}
                    >
                      Undo
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
