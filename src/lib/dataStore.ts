import { ledgerApi } from '../api/client';
import type {
  Account,
  Category,
  CategoryGroup,
  Payee,
  Plan,
  Stats,
  SyncChanges,
  Transaction,
} from '../api/types';
import {
  FULL_SYNC_INTERVAL_MS,
  loadMeta,
  loadSnapshot,
  saveMeta,
  saveSnapshot,
  type LedgerMeta,
} from './ledgerPersist';

export interface LedgerData {
  plan: Plan;
  stats: Stats | null;
  accounts: Account[];
  groups: CategoryGroup[];
  categories: Category[];
  payees: Payee[];
  transactions: Transaction[];
  loadedAt: number;
}

type Listener = () => void;

let cache: LedgerData | null = null;
let meta: LedgerMeta | null = null;
let loading: Promise<LedgerData> | null = null;
let bootstrapped = false;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify() {
  listeners.forEach((fn) => fn());
}

export function getCache(): LedgerData | null {
  return cache;
}

function txnKey(t: Transaction): string {
  return t.id || t.clientId || t.ynabId;
}

function sortTxns(list: Transaction[]): Transaction[] {
  return list
    .filter((t) => !t.deleted)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function applyDelta(base: LedgerData, pack: SyncChanges): LedgerData {
  const accountMap = new Map(base.accounts.map((a) => [a.ynabId, a]));
  for (const a of pack.accounts || []) {
    if (a.deleted || a.closed) {
      accountMap.delete(a.ynabId);
    } else {
      accountMap.set(a.ynabId, {
        ynabId: a.ynabId,
        name: a.name,
        type: a.type,
        balance: a.balance,
        onBudget: a.onBudget,
        closed: a.closed,
        note: a.note,
        transferPayeeId: a.transferPayeeId,
      });
    }
  }

  const groupMap = new Map(base.groups.map((g) => [g.ynabId, g]));
  for (const g of pack.groups || []) {
    if (g.deleted) groupMap.delete(g.ynabId);
    else {
      groupMap.set(g.ynabId, {
        ynabId: g.ynabId,
        name: g.name,
        hidden: g.hidden,
      });
    }
  }

  const catMap = new Map(base.categories.map((c) => [c.ynabId, c]));
  for (const c of pack.categories || []) {
    if (c.deleted) catMap.delete(c.ynabId);
    else {
      catMap.set(c.ynabId, {
        ynabId: c.ynabId,
        name: c.name,
        categoryGroupId: c.categoryGroupId,
        hidden: c.hidden,
        color: c.color,
      });
    }
  }

  const payeeMap = new Map(base.payees.map((p) => [p.ynabId, p]));
  for (const p of pack.payees || []) {
    if (p.deleted) payeeMap.delete(p.ynabId);
    else {
      payeeMap.set(p.ynabId, {
        ynabId: p.ynabId,
        name: p.name,
        transferAccountId: p.transferAccountId,
      });
    }
  }

  const txnMap = new Map(base.transactions.map((t) => [txnKey(t), t]));
  for (const t of pack.transactions || []) {
    const k = txnKey(t);
    if (!k) continue;
    if (t.deleted) {
      txnMap.delete(k);
      // Also drop by ynabId alias if different
      if (t.ynabId) txnMap.delete(t.ynabId);
    } else {
      txnMap.set(k, { ...t, deleted: false });
    }
  }

  return {
    plan: pack.plan || base.plan,
    stats: base.stats,
    accounts: Array.from(accountMap.values()),
    groups: Array.from(groupMap.values()),
    categories: Array.from(catMap.values()),
    payees: Array.from(payeeMap.values()),
    transactions: sortTxns(Array.from(txnMap.values())),
    loadedAt: Date.now(),
  };
}

function fromFullPack(pack: SyncChanges, stats: Stats | null): LedgerData {
  return {
    plan: pack.plan || {
      name: 'Plan',
      currency: 'USD',
      serverKnowledge: 0,
    },
    stats,
    accounts: (pack.accounts || [])
      .filter((a) => !a.deleted && !a.closed)
      .map((a) => ({
        ynabId: a.ynabId,
        name: a.name,
        type: a.type,
        balance: a.balance,
        onBudget: a.onBudget,
        closed: a.closed,
        note: a.note,
        transferPayeeId: a.transferPayeeId,
      })),
    groups: (pack.groups || [])
      .filter((g) => !g.deleted)
      .map((g) => ({
        ynabId: g.ynabId,
        name: g.name,
        hidden: g.hidden,
      })),
    categories: (pack.categories || [])
      .filter((c) => !c.deleted)
      .map((c) => ({
        ynabId: c.ynabId,
        name: c.name,
        categoryGroupId: c.categoryGroupId,
        hidden: c.hidden,
        color: c.color,
      })),
    payees: (pack.payees || [])
      .filter((p) => !p.deleted)
      .map((p) => ({
        ynabId: p.ynabId,
        name: p.name,
        transferAccountId: p.transferAccountId,
      })),
    transactions: sortTxns(pack.transactions || []),
    loadedAt: Date.now(),
  };
}

async function persist(data: LedgerData, nextMeta: LedgerMeta) {
  cache = data;
  meta = nextMeta;
  notify();
  await Promise.all([saveSnapshot(data), saveMeta(nextMeta)]);
}

/**
 * Hydrate memory + IndexedDB first (instant UI), then pull delta/full from API.
 *
 * @param force when true, revalidate from network (still prefers delta unless full due)
 * @param forceFull when true, force full snapshot download
 */
export async function loadLedger(
  force = false,
  forceFull = false,
): Promise<LedgerData> {
  // Instant path: return in-memory without network if warm and not forced.
  if (cache && !force) return cache;
  if (loading && !force) return loading;

  loading = (async () => {
    // 1) Disk hydrate so Home/Spending paint without waiting on AWS.
    if (!bootstrapped) {
      bootstrapped = true;
      const [snap, m] = await Promise.all([loadSnapshot(), loadMeta()]);
      meta = m;
      if (snap?.transactions) {
        cache = {
          ...(snap as unknown as LedgerData),
          transactions: sortTxns(
            snap.transactions as unknown as Transaction[],
          ),
        };
        notify();
      }
    }

    const now = Date.now();
    const cursor = meta?.cursor || 0;
    const lastFullAt = meta?.lastFullAt || 0;
    const fullDue =
      forceFull ||
      !cache ||
      cursor <= 0 ||
      !lastFullAt ||
      now - lastFullAt >= FULL_SYNC_INTERVAL_MS;

    // 2) Network: paged changes call (full when empty / interval). Multi-page
    // merges keep us under the Lambda 6MB response limit (~7k+ txns).
    const pack = await ledgerApi.syncChangesAll(fullDue ? 0 : cursor, fullDue);
    const [stats, inbox] = await Promise.all([
      ledgerApi.stats().catch(() => cache?.stats ?? null),
      ledgerApi.inbox().catch(() => null),
    ]);

    let next: LedgerData;
    if (pack.mode === 'full' || fullDue || !cache) {
      next = fromFullPack(pack, stats);
    } else {
      next = applyDelta(cache, pack);
      next = { ...next, stats };
    }

    // 3) Always merge authoritative inbox so Categorization matches YNAB even
    // when an older partial full-sync left unapproved rows out of IndexedDB
    // (deltas never re-send unchanged unapproved).
    if (inbox?.transactions?.length) {
      next = mergeInboxIntoLedger(next, inbox.transactions);
      if (stats && inbox.count != null) {
        next = {
          ...next,
          stats: {
            ...stats,
            inbox: {
              count: inbox.count,
              unapproved: inbox.unapproved,
              uncategorized: inbox.uncategorized,
            },
          },
        };
      }
    }

    // 4) If local still far below server txn total, force full next open.
    const serverTxnTotal = stats?.byType?.transaction ?? 0;
    const localTxnTotal = next.transactions.length;
    const underfilled =
      serverTxnTotal > 0 && localTxnTotal < Math.floor(serverTxnTotal * 0.85);

    const nextMeta: LedgerMeta = {
      cursor: pack.cursor || pack.serverTime || now,
      lastFullAt:
        pack.mode === 'full' || fullDue
          ? underfilled
            ? 0
            : now
          : lastFullAt || now,
      lastSyncedAt: now,
    };
    await persist(next, nextMeta);
    return next;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

/**
 * Background revalidation used after first paint from cache.
 * Safe to call multiple times; shares in-flight load.
 */
export function revalidateLedger(forceFull = false): Promise<LedgerData> {
  return loadLedger(true, forceFull);
}

export function accountMap(data: LedgerData): Map<string, Account> {
  return new Map(data.accounts.map((a) => [a.ynabId, a]));
}

export function categoryMap(data: LedgerData): Map<string, Category> {
  return new Map(data.categories.map((c) => [c.ynabId, c]));
}

export function payeeMap(data: LedgerData): Map<string, Payee> {
  return new Map(data.payees.map((p) => [p.ynabId, p]));
}

export function resolvePayee(
  data: LedgerData,
  payeeId?: string | null,
): string {
  if (!payeeId) return '—';
  return payeeMap(data).get(payeeId)?.name || 'Unknown payee';
}

export function resolveCategory(
  data: LedgerData,
  categoryId?: string | null,
  txn?: Transaction,
): string {
  if (txn?.transferAccountId) {
    const acct = accountMap(data).get(txn.transferAccountId);
    return acct ? `Transfer: ${acct.name}` : 'Transfer';
  }
  if (!categoryId) return 'Uncategorized';
  const cat = categoryMap(data).get(categoryId);
  if (!cat) return 'Unknown category';
  const group = data.groups.find((g) => g.ynabId === cat.categoryGroupId);
  return group ? `${group.name}: ${cat.name}` : cat.name;
}

/** Hide internal / CC-payment / system categories from the categorize picker. */
export function isAssignableCategory(
  groupName?: string | null,
  categoryName?: string | null,
): boolean {
  const g = (groupName || '').toLowerCase();
  const c = (categoryName || '').toLowerCase();
  if (g === 'internal master category') return false;
  if (g === 'credit card payments') return false;
  if (g === 'hidden categories') return false;
  if (c === 'uncategorized') return false;
  if (c.includes('ready to assign')) return false;
  return true;
}

/**
 * YNAB-style needs-attention (Categorization):
 * - unapproved always (including transfers)
 * - approved + on-budget + no category / "Uncategorized" (no split / transfer)
 *
 * Must match API listInbox + Android DomainRules so counts match YNAB (~104).
 */
export function isInboxTxn(
  t: Transaction,
  data?: LedgerData | null,
): boolean {
  if (t.deleted) return false;
  if (!t.approved) return true;
  if (t.transferAccountId) return false;
  const subs = t.subtransactions;
  if (Array.isArray(subs) && subs.length > 0) return false;
  if (data) {
    const acct = accountMap(data).get(t.accountId);
    if (acct && acct.onBudget === false) return false;
  }
  if (!t.categoryId) return true;
  if (data) {
    const cat = categoryMap(data).get(t.categoryId);
    if (cat?.name?.toLowerCase() === 'uncategorized') return true;
  }
  return false;
}

/** Upsert authoritative /v1/inbox rows into a ledger snapshot. */
function mergeInboxIntoLedger(
  base: LedgerData,
  inboxTxns: Transaction[],
): LedgerData {
  if (!inboxTxns.length) return base;
  // Index existing rows by every stable key so we update rather than duplicate.
  const byAnyKey = new Map<string, Transaction>();
  for (const t of base.transactions) {
    const k = txnKey(t);
    if (k) byAnyKey.set(k, t);
    if (t.ynabId) byAnyKey.set(t.ynabId, t);
    if (t.clientId) byAnyKey.set(t.clientId, t);
    if (t.id) byAnyKey.set(t.id, t);
  }
  const final = new Map<string, Transaction>();
  for (const t of base.transactions) {
    final.set(txnKey(t), t);
  }
  for (const raw of inboxTxns) {
    const incoming: Transaction = {
      ...raw,
      subtransactions: raw.subtransactions || [],
      deleted: false,
    };
    const k = txnKey(incoming);
    if (!k) continue;
    const prev =
      byAnyKey.get(k) ||
      (incoming.ynabId ? byAnyKey.get(incoming.ynabId) : undefined);
    const merged = prev
      ? { ...prev, ...incoming, deleted: false }
      : incoming;
    // Drop the previous key if it differed (clientId vs ynabId).
    if (prev) {
      const prevKey = txnKey(prev);
      if (prevKey && prevKey !== k) final.delete(prevKey);
    }
    final.set(k, merged);
    byAnyKey.set(k, merged);
    if (merged.ynabId) byAnyKey.set(merged.ynabId, merged);
  }
  return {
    ...base,
    transactions: sortTxns(Array.from(final.values())),
    loadedAt: Date.now(),
  };
}

export function patchTransactionCategory(
  ynabTxnId: string,
  categoryYnabId: string,
) {
  if (!cache) return;
  cache = {
    ...cache,
    transactions: cache.transactions.map((t) =>
      t.ynabId === ynabTxnId
        ? { ...t, categoryId: categoryYnabId, approved: true }
        : t,
    ),
  };
  notify();
  void saveSnapshot(cache);
}

export function patchTransactionCategoryMany(
  ynabTxnIds: string[],
  categoryYnabId: string,
) {
  if (!cache || ynabTxnIds.length === 0) return;
  const set = new Set(ynabTxnIds);
  cache = {
    ...cache,
    transactions: cache.transactions.map((t) =>
      set.has(t.ynabId)
        ? { ...t, categoryId: categoryYnabId, approved: true }
        : t,
    ),
  };
  notify();
  void saveSnapshot(cache);
}

/**
 * Restore categoryId + approved from pre-categorize snapshots (undo).
 * Rows reappear in the inbox if they were unapproved / uncategorized.
 */
export function restoreTransactionSnapshots(snapshots: Transaction[]) {
  if (!cache || snapshots.length === 0) return;
  const byId = new Map(snapshots.map((t) => [t.ynabId, t]));
  cache = {
    ...cache,
    transactions: cache.transactions.map((t) => {
      const snap = byId.get(t.ynabId);
      if (!snap) return t;
      return {
        ...t,
        categoryId: snap.categoryId,
        approved: snap.approved,
      };
    }),
  };
  notify();
  void saveSnapshot(cache);
}

export function patchTransactionApproved(ynabTxnIds: string[]) {
  if (!cache || ynabTxnIds.length === 0) return;
  const set = new Set(ynabTxnIds);
  cache = {
    ...cache,
    transactions: cache.transactions.map((t) =>
      set.has(t.ynabId) ? { ...t, approved: true } : t,
    ),
  };
  notify();
  void saveSnapshot(cache);
}

export function patchTransactionFields(
  ynabTxnId: string,
  fields: Partial<
    Pick<
      Transaction,
      'amount' | 'memo' | 'payeeId' | 'categoryId' | 'approved' | 'cleared'
    >
  > & { payeeName?: string },
) {
  if (!cache) return;
  cache = {
    ...cache,
    transactions: cache.transactions.map((t) =>
      t.ynabId === ynabTxnId ? { ...t, ...fields } : t,
    ),
  };
  notify();
  void saveSnapshot(cache);
}

/** Human category / system type for list rows. Prefer categoryChipForTxn for UI. */
export function displayCategoryLabel(
  data: LedgerData,
  t: Transaction,
): string {
  if (t.transferAccountId) {
    const acct = accountMap(data).get(t.transferAccountId);
    return acct ? `Transfer: ${acct.name}` : 'Transfer';
  }
  if (!t.categoryId) return 'Category Needed';
  const cat = categoryMap(data).get(t.categoryId);
  if (!cat) return 'Unknown category';
  if (cat.name.toLowerCase() === 'uncategorized') return 'Category Needed';
  if (cat.name.toLowerCase().includes('credit card payment')) {
    return 'Credit Card Payment';
  }
  return cat.name;
}

export function formatClearedLabel(
  cleared: string,
  approved: boolean,
): string {
  if (!approved) return 'needs approval';
  const c = (cleared || 'uncleared').toLowerCase();
  if (c === 'reconciled') return 'reconciled';
  if (c === 'cleared') return 'cleared';
  return 'uncleared';
}

export { accountTypeLabel } from './accountGroups';
