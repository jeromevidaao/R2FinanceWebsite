import { useMemo, useState, type FormEvent } from 'react';
import { ledgerApi } from '../api/client';
import type { Category, CategoryGroup } from '../api/types';
import { ErrorPanel, Loading } from '../components/Loading';
import { useLedger } from '../hooks/useLedger';
import {
  isAssignableCategory,
  removeCategoryLocal,
  upsertCategoryLocal,
} from '../lib/dataStore';
import { formatMoney, moneyClass, monthKey } from '../lib/money';

type EditorMode =
  | { kind: 'create' }
  | { kind: 'edit'; category: Category }
  | null;

/**
 * Browse + manage plan categories (add / rename / move / delete).
 * Mutations dual-write to R2Finance DynamoDB and YNAB (create/update).
 * Delete is soft-delete in R2; YNAB has no documented category DELETE.
 */
export function CategoriesPage() {
  const { data, loading, error, refresh } = useLedger();
  const [q, setQ] = useState('');
  const thisMonth = monthKey(new Date().toISOString().slice(0, 10));
  const [editor, setEditor] = useState<EditorMode>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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

  const editableGroups = useMemo(() => {
    if (!data) return [] as CategoryGroup[];
    return data.groups
      .filter((g) => !g.hidden && isAssignableCategory(g.name, ''))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

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
      .filter((s) => s.cats.length > 0 || (!needle && isAssignableCategory(s.group.name, '')));
  }, [data, q]);

  async function handleCreate(name: string, categoryGroupId: string) {
    setErr(null);
    setMsg(null);
    setBusyId('create');
    try {
      const res = await ledgerApi.createCategory(name, categoryGroupId);
      if (res.category) upsertCategoryLocal(res.category);
      setMsg(`Created “${res.category?.name || name}” in R2Finance + YNAB`);
      setEditor(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleUpdate(
    ynabId: string,
    body: { name?: string; categoryGroupId?: string },
  ) {
    setErr(null);
    setMsg(null);
    setBusyId(ynabId);
    try {
      const res = await ledgerApi.updateCategory(ynabId, body);
      if (res.category) upsertCategoryLocal(res.category);
      setMsg(`Updated “${res.category?.name || body.name || 'category'}” in R2Finance + YNAB`);
      setEditor(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(c: Category) {
    const ok = window.confirm(
      `Delete category “${c.name}”?\n\nIt will be removed from R2Finance. YNAB may not support delete via API — hide or delete it in YNAB if it should disappear there too.`,
    );
    if (!ok) return;
    setErr(null);
    setMsg(null);
    setBusyId(c.ynabId);
    try {
      const res = await ledgerApi.deleteCategory(c.ynabId);
      removeCategoryLocal(c.ynabId);
      if (res.ynab) {
        setMsg(`Deleted “${c.name}” from R2Finance + YNAB`);
      } else {
        setMsg(
          res.warning ||
            `Removed “${c.name}” from R2Finance (YNAB delete not available via API)`,
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
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
          <h1>Categories</h1>
          <p className="muted">
            {data.categories.filter((c) => !c.hidden).length} categories ·
            activity for {thisMonth} · changes sync to R2Finance + YNAB
          </p>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void refresh(true)}
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setErr(null);
              setEditor({ kind: 'create' });
            }}
            disabled={editableGroups.length === 0}
          >
            Add category
          </button>
        </div>
      </header>

      {msg && (
        <p className="alert-ok categories-flash" role="status">
          {msg}
        </p>
      )}
      {err && (
        <p className="alert-error categories-flash" role="alert">
          {err}
        </p>
      )}

      <input
        className="input search"
        placeholder="Search categories…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {sections.length === 0 ? (
        <section className="panel">
          <p className="muted">No categories match.</p>
        </section>
      ) : (
        sections.map(({ group, cats }) => {
          const canEditGroup = isAssignableCategory(group.name, '');
          return (
            <section key={group.ynabId} className="panel">
              <div className="panel-head">
                <h2>{group.name}</h2>
                <span className="muted small">
                  {cats.length} categor{cats.length === 1 ? 'y' : 'ies'}
                </span>
              </div>
              {cats.length === 0 ? (
                <p className="muted small">No categories in this group yet.</p>
              ) : (
                <ul className="ranked-list cat-manage-list">
                  {cats.map((c) => {
                    const spent = spendByCat.get(c.ynabId) || 0;
                    const canEdit =
                      canEditGroup && isAssignableCategory(group.name, c.name);
                    const busy = busyId === c.ynabId;
                    return (
                      <li key={c.ynabId} className="cat-manage-row">
                        <span className="cat-manage-name">{c.name}</span>
                        <span className={`mono ${moneyClass(spent)}`}>
                          {spent ? formatMoney(spent) : '—'}
                        </span>
                        {canEdit ? (
                          <span className="cat-manage-actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={!!busyId}
                              onClick={() => {
                                setErr(null);
                                setEditor({ kind: 'edit', category: c });
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm cat-delete-btn"
                              disabled={!!busyId || busy}
                              onClick={() => void handleDelete(c)}
                            >
                              {busy ? '…' : 'Delete'}
                            </button>
                          </span>
                        ) : (
                          <span className="muted small cat-manage-locked">
                            System
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })
      )}

      {editor && (
        <CategoryEditorModal
          mode={editor}
          groups={editableGroups}
          busy={!!busyId}
          onClose={() => setEditor(null)}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
}

function CategoryEditorModal({
  mode,
  groups,
  busy,
  onClose,
  onCreate,
  onUpdate,
}: {
  mode: Exclude<EditorMode, null>;
  groups: CategoryGroup[];
  busy: boolean;
  onClose: () => void;
  onCreate: (name: string, categoryGroupId: string) => Promise<void>;
  onUpdate: (
    ynabId: string,
    body: { name?: string; categoryGroupId?: string },
  ) => Promise<void>;
}) {
  const isEdit = mode.kind === 'edit';
  const [name, setName] = useState(
    isEdit ? mode.category.name : '',
  );
  const [groupId, setGroupId] = useState(() => {
    if (isEdit && mode.category.categoryGroupId) {
      return mode.category.categoryGroupId;
    }
    return groups[0]?.ynabId || '';
  });
  const [localErr, setLocalErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) {
      setLocalErr('Name is required');
      return;
    }
    if (!groupId) {
      setLocalErr('Pick a category group');
      return;
    }
    setLocalErr(null);
    if (mode.kind === 'create') {
      await onCreate(n, groupId);
      return;
    }
    const body: { name?: string; categoryGroupId?: string } = {};
    if (n !== mode.category.name) body.name = n;
    if (groupId !== (mode.category.categoryGroupId || '')) {
      body.categoryGroupId = groupId;
    }
    if (!body.name && !body.categoryGroupId) {
      onClose();
      return;
    }
    await onUpdate(mode.category.ynabId, body);
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cat-editor-title"
      >
        <div className="modal-head">
          <h2 id="cat-editor-title">
            {isEdit ? 'Edit category' : 'Add category'}
          </h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>
        <form className="modal-body form-stack" onSubmit={(e) => void submit(e)}>
          <label>
            Name
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Coffee shops"
              maxLength={100}
              autoFocus
              disabled={busy}
            />
          </label>
          <label>
            Group
            <select
              className="input"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={busy || groups.length === 0}
            >
              {groups.map((g) => (
                <option key={g.ynabId} value={g.ynabId}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">
            Saves to R2Finance DynamoDB and pushes to YNAB immediately.
          </p>
          {localErr && (
            <p className="alert-error" role="alert">
              {localErr}
            </p>
          )}
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
