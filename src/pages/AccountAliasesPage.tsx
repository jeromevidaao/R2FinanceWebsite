import { useMemo, useState } from 'react';
import { ledgerApi } from '../api/client';
import type { Account } from '../api/types';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import {
  ACCOUNT_GROUPS,
  accountGroupKey,
  accountTypeLabel,
  inferInstitution,
} from '../lib/accountGroups';
import {
  extractAccountMask,
  patchAccountFields,
  resolveAccountName,
} from '../lib/dataStore';
import { formatMoney, moneyClass } from '../lib/money';

/**
 * Ledger account nicknames used across Categorization, transfers, filters.
 * Pre-seeded from YNAB account names (GET /plans/…/accounts → name; YNAB has
 * no separate alias field). Edits stay in R2Finance only — never pushed back.
 */
export function AccountAliasesPage() {
  const { data, loading, error, refresh } = useLedger();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const sections = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const open = data.accounts.filter((a) => !a.closed);
    const filtered = needle
      ? open.filter((a) => {
          const hay = [
            a.name,
            a.alias || '',
            a.type,
            a.mask || extractAccountMask(a.name) || '',
          ]
            .join(' ')
            .toLowerCase();
          return hay.includes(needle);
        })
      : open;

    return ACCOUNT_GROUPS.map((g) => ({
      ...g,
      accounts: filtered
        .filter((a) => accountGroupKey(a.type, a.onBudget) === g.key)
        .sort((a, b) =>
          resolveAccountName(a).localeCompare(resolveAccountName(b)),
        ),
    })).filter((s) => s.accounts.length > 0);
  }, [data, q]);

  function draftFor(a: Account): string {
    if (Object.prototype.hasOwnProperty.call(drafts, a.ynabId)) {
      return drafts[a.ynabId];
    }
    return a.alias || '';
  }

  function setDraft(ynabId: string, value: string) {
    setDrafts((d) => ({ ...d, [ynabId]: value }));
  }

  function isDirty(a: Account): boolean {
    const current = (a.alias || '').trim();
    const next = draftFor(a).trim();
    return current !== next;
  }

  async function save(a: Account, override?: string) {
    const next = (override !== undefined ? override : draftFor(a)).trim();
    const alias = next || null;
    setSavingId(a.ynabId);
    setErr(null);
    setMsg(null);
    try {
      const res = await ledgerApi.setAccountAlias(a.ynabId, alias);
      const saved = res.account;
      patchAccountFields(a.ynabId, {
        alias: saved.alias ?? null,
        aliasUserSet: saved.aliasUserSet ?? !!alias,
        mask: saved.mask ?? extractAccountMask(saved.name || a.name),
      });
      setDrafts((d) => {
        const copy = { ...d };
        delete copy[a.ynabId];
        return copy;
      });
      setMsg(
        alias
          ? `Saved alias “${alias}” for ${a.name}`
          : `Cleared custom alias for ${a.name} (will re-seed from YNAB on next sync)`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  }

  async function seedFromYnab() {
    setSeeding(true);
    setErr(null);
    setMsg(null);
    try {
      const report = await ledgerApi.seedAccountAliases();
      setDrafts({});
      await refresh(true);
      setMsg(
        report.seeded > 0
          ? `Pre-filled ${report.seeded} alias${report.seeded === 1 ? '' : 'es'} from YNAB names (${report.skipped} already set or skipped)`
          : `All accounts already have aliases (${report.skipped} skipped). Edit any nickname for R2 only.`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  }

  if (loading && !data) return <Loading />;
  if (error && !data)
    return <ErrorPanel message={error} onRetry={() => void refresh()} />;
  if (!data) return <Loading />;

  const total = data.accounts.filter((a) => !a.closed).length;
  const withAlias = data.accounts.filter(
    (a) => !a.closed && a.alias?.trim(),
  ).length;
  const customCount = data.accounts.filter(
    (a) => !a.closed && a.aliasUserSet && a.alias?.trim(),
  ).length;
  const missingAlias = data.accounts.filter(
    (a) => !a.closed && !(a.alias || '').trim(),
  ).length;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Account aliases</h1>
          <p className="muted">
            Nicknames for every ledger account — reused in Categorization,
            transfers, filters, and registers. They start from your{' '}
            <strong>YNAB account names</strong> (pulled via the YNAB API; YNAB
            has no separate alias field). Edit anytime for R2 only — never
            written back to YNAB. Last-4 is taken from the YNAB name when
            present.
          </p>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={seeding}
            onClick={() => void seedFromYnab()}
            title="Fill empty aliases from current YNAB account names"
          >
            {seeding ? 'Seeding…' : 'Fill from YNAB names'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void refresh(true)}
          >
            Refresh
          </button>
        </div>
      </header>

      <p className="muted small" style={{ marginBottom: 12 }}>
        {total} open account{total === 1 ? '' : 's'}
        {withAlias > 0 ? ` · ${withAlias} with a nickname` : ''}
        {customCount > 0 ? ` · ${customCount} custom` : ''}
        {missingAlias > 0
          ? ` · ${missingAlias} still empty — use “Fill from YNAB names”`
          : ''}
      </p>

      <input
        className="input search"
        placeholder="Search name, alias, last-4, type…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {sections.length === 0 ? (
        <section className="panel">
          <p className="muted">No accounts match.</p>
        </section>
      ) : (
        sections.map((section) => (
          <section key={section.key} className="panel account-group-panel">
            <div className="panel-head account-group-head">
              <h2>{section.title}</h2>
              <span className="muted small">
                {section.accounts.length} account
                {section.accounts.length === 1 ? '' : 's'}
              </span>
            </div>
            <ul className="alias-list">
              {section.accounts.map((a) => {
                const brand = inferInstitution(a.name, a.type, a.onBudget);
                const mask = a.mask || extractAccountMask(a.name);
                const dirty = isDirty(a);
                const busy = savingId === a.ynabId;
                return (
                  <li key={a.ynabId} className="alias-row">
                    <span
                      className="alias-brand"
                      style={{ background: brand.bg, color: brand.fg }}
                      title={brand.label}
                      aria-hidden
                    >
                      {brand.mark}
                    </span>
                    <div className="alias-main">
                      <div className="row-title">
                        {resolveAccountName(a)}
                        {a.alias?.trim() && a.alias.trim() !== a.name ? (
                          <span className="muted small">
                            {' '}
                            · YNAB: {a.name}
                          </span>
                        ) : null}
                        {a.aliasUserSet ? (
                          <span className="muted small"> · custom</span>
                        ) : a.alias?.trim() ? (
                          <span className="muted small"> · from YNAB</span>
                        ) : null}
                      </div>
                      <div className="muted small">
                        {accountTypeLabel(a.type)}
                        {mask ? ` · ••••${mask}` : ''}
                        {' · '}
                        <span className={`mono ${moneyClass(a.balance)}`}>
                          {formatMoney(a.balance)}
                        </span>
                        {a.onBudget ? '' : ' · tracking'}
                      </div>
                      <div className="alias-edit">
                        <label className="alias-label">
                          <span className="muted small">Nickname / alias</span>
                          <input
                            className="input"
                            value={draftFor(a)}
                            placeholder={
                              mask
                                ? `e.g. Jerome Chase ••••${mask}`
                                : 'e.g. Joint checking'
                            }
                            disabled={busy}
                            onChange={(e) => setDraft(a.ynabId, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && dirty && !busy) {
                                e.preventDefault();
                                void save(a);
                              }
                            }}
                          />
                        </label>
                        <div className="btn-row alias-actions">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={!dirty || busy}
                            onClick={() => void save(a)}
                          >
                            {busy ? 'Saving…' : 'Save'}
                          </button>
                          {dirty && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={busy}
                              onClick={() =>
                                setDrafts((d) => {
                                  const copy = { ...d };
                                  delete copy[a.ynabId];
                                  return copy;
                                })
                              }
                            >
                              Reset
                            </button>
                          )}
                          {((a.alias || '').trim() || draftFor(a).trim()) && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={busy}
                              onClick={() => {
                                setDraft(a.ynabId, '');
                                void save(a, '');
                              }}
                              title="Clear nickname"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {msg && <p className="muted small">{msg}</p>}
      {err && <ErrorPanel message={err} />}
    </div>
  );
}
