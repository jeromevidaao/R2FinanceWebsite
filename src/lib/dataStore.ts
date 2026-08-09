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
import { resolveDisplayPayeeForTxn } from './displayPayee';

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
/** Bumps on every network load start; stale loads must not persist. */
let loadSeq = 0;
let bootstrapped = false;
const listeners = new Set<Listener>();

/**
 * Category create/update/delete can race an in-flight full or delta ledger
 * sync. Multi-page full packs read CAT# on page 0, then spend seconds paging
 * TXN#; if create lands after that query, the finishing pack lacks the new
 * category and `fromFullPack` would wipe the optimistic upsert. Cursor would
 * also advance past the new row’s updatedAt, so later deltas never re-send it.
 *
 * Pending patches re-apply after every network merge until the server pack
 * itself includes (or omits, for deletes) the mutation.
 */
const pendingCategoryUpserts = new Map<string, Category>();
const pendingCategoryDeletes = new Set<string>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify() {
  listeners.forEach((fn) => fn());
}

/**
 * Re-apply local category mutations that have not yet been confirmed by an
 * *incoming* ledger pack (not the merged cache).
 *
 * Confirm only from pack ids:
 * - upsert settled when pack lists that category id
 * - delete settled on full pack when id is absent, or delta tombstone
 *
 * Do not confirm from GET /v1/categories merges — an older multi-page full
 * pack can still finish afterward without the new row.
 * Exported for unit tests.
 */
export function applyPendingCategoryMutations(
  data: LedgerData,
  opts: {
    /** Live category ids from the incoming pack (excludes deleted tombstones). */
    packCategoryIds?: Set<string>;
    /** True when the pack is a full category snapshot. */
    fullPack?: boolean;
    /** Category ids tombstoned in a delta pack. */
    packDeletedIds?: Set<string>;
  } = {},
): LedgerData {
  if (pendingCategoryUpserts.size === 0 && pendingCategoryDeletes.size === 0) {
    return data;
  }

  if (opts.packCategoryIds) {
    for (const id of [...pendingCategoryUpserts.keys()]) {
      if (opts.packCategoryIds.has(id)) pendingCategoryUpserts.delete(id);
    }
    if (opts.fullPack) {
      for (const id of [...pendingCategoryDeletes]) {
        if (!opts.packCategoryIds.has(id)) pendingCategoryDeletes.delete(id);
      }
    }
  }
  if (opts.packDeletedIds) {
    for (const id of [...pendingCategoryDeletes]) {
      if (opts.packDeletedIds.has(id)) pendingCategoryDeletes.delete(id);
    }
  }

  if (pendingCategoryUpserts.size === 0 && pendingCategoryDeletes.size === 0) {
    return data;
  }

  let categories = data.categories.filter(
    (c) => !pendingCategoryDeletes.has(c.ynabId),
  );
  for (const cat of pendingCategoryUpserts.values()) {
    if (pendingCategoryDeletes.has(cat.ynabId)) continue;
    const i = categories.findIndex((c) => c.ynabId === cat.ynabId);
    if (i >= 0) categories[i] = { ...categories[i], ...cat };
    else categories.push(cat);
  }
  return { ...data, categories };
}

/** Test / reset helper — clears pending category mutation queues. */
export function clearPendingCategoryMutations(): void {
  pendingCategoryUpserts.clear();
  pendingCategoryDeletes.clear();
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
        alias: a.alias ?? null,
        mask: a.mask ?? extractAccountMask(a.name),
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
        alias: a.alias ?? null,
        mask: a.mask ?? extractAccountMask(a.name),
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

  const seq = ++loadSeq;
  const myLoad = (async () => {
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

    // 3b) Keep just-created/edited categories through in-flight full/delta races.
    // Settle pending only from *this pack's* category ids (not merged cache).
    const packCats = pack.categories || [];
    const packCategoryIds = new Set(
      packCats.filter((c) => !c.deleted).map((c) => c.ynabId),
    );
    const packDeletedIds = new Set(
      packCats.filter((c) => c.deleted).map((c) => c.ynabId),
    );
    next = applyPendingCategoryMutations(next, {
      packCategoryIds,
      fullPack: pack.mode === 'full' || fullDue,
      packDeletedIds,
    });

    // Newer load or local category mutation superseded this pack — do not
    // persist (would wipe optimistic creates). Prefer live cache when present.
    if (seq !== loadSeq) {
      return cache ?? next;
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

  loading = myLoad;
  try {
    return await myLoad;
  } finally {
    if (loading === myLoad) loading = null;
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

/** Last-4 from a YNAB account name when it ends with digits. */
export function extractAccountMask(name?: string | null): string | null {
  const m = String(name || '').match(/(\d{4})\s*$/);
  return m ? m[1] : null;
}

/**
 * Display name for an account: user alias when set, else YNAB name.
 * Use everywhere accounts appear (Categorization, filters, transfers).
 */
export function resolveAccountName(
  account: Account | null | undefined,
  fallback = 'Account',
): string {
  if (!account) return fallback;
  const alias = account.alias?.trim();
  return alias || account.name || fallback;
}

/** Resolve account id → display name from ledger data. */
export function resolveAccount(
  data: LedgerData,
  accountId?: string | null,
): string {
  if (!accountId) return 'Account';
  return resolveAccountName(accountMap(data).get(accountId));
}

/** Subtitle bits: type · ••••mask */
export function accountIdentityLine(account: Account): string {
  const parts: string[] = [];
  if (account.type) parts.push(account.type);
  const mask = account.mask || extractAccountMask(account.name);
  if (mask) parts.push(`••••${mask}`);
  return parts.join(' · ');
}

/** Patch one account in the local cache (after alias save). */
export function patchAccountFields(
  ynabId: string,
  fields: Partial<Account>,
): void {
  if (!cache) return;
  const accounts = cache.accounts.map((a) =>
    a.ynabId === ynabId ? { ...a, ...fields } : a,
  );
  cache = { ...cache, accounts };
  notify();
  void saveSnapshot(cache);
}

/** Upsert one category in the local cache (after create/update). */
export function upsertCategoryLocal(cat: Category): void {
  const clean: Category = {
    ynabId: cat.ynabId,
    name: cat.name,
    categoryGroupId: cat.categoryGroupId ?? null,
    hidden: cat.hidden ?? false,
    color: cat.color ?? null,
  };
  pendingCategoryUpserts.set(clean.ynabId, clean);
  pendingCategoryDeletes.delete(clean.ynabId);
  // Invalidate in-flight ledger loads so a pack that started before this
  // mutation cannot persist and wipe the optimistic update.
  loadSeq += 1;
  if (!cache) return;
  const categories = [...cache.categories];
  const i = categories.findIndex((c) => c.ynabId === clean.ynabId);
  if (i >= 0) categories[i] = { ...categories[i], ...clean };
  else categories.push(clean);
  cache = { ...cache, categories };
  notify();
  void saveSnapshot(cache);
}

/** Remove a category from the local cache (after delete). */
export function removeCategoryLocal(ynabId: string): void {
  pendingCategoryDeletes.add(ynabId);
  pendingCategoryUpserts.delete(ynabId);
  loadSeq += 1;
  if (!cache) return;
  cache = {
    ...cache,
    categories: cache.categories.filter((c) => c.ynabId !== ynabId),
  };
  notify();
  void saveSnapshot(cache);
}

/**
 * Merge an authoritative GET /v1/categories snapshot into the local cache.
 * Used after create/update/delete so categorize pickers see the new set even
 * when a concurrent ledger full-pack was still mid-flight.
 */
export function mergeCategoriesFromServer(
  categories: Category[],
  groups?: CategoryGroup[],
): void {
  if (!cache) return;
  const nextCats = categories.map((c) => ({
    ynabId: c.ynabId,
    name: c.name,
    categoryGroupId: c.categoryGroupId ?? null,
    hidden: c.hidden ?? false,
    color: c.color ?? null,
  }));

  let nextGroups = cache.groups;
  if (groups?.length) {
    const gMap = new Map(cache.groups.map((g) => [g.ynabId, g]));
    for (const g of groups) {
      gMap.set(g.ynabId, {
        ynabId: g.ynabId,
        name: g.name,
        hidden: g.hidden ?? false,
      });
    }
    nextGroups = Array.from(gMap.values());
  }

  // Do not confirm/clear pending here — an older multi-page full pack may still
  // finish without the new category and needs pending to re-apply.
  let next: LedgerData = {
    ...cache,
    groups: nextGroups,
    categories: nextCats,
  };
  next = applyPendingCategoryMutations(next);
  cache = next;
  notify();
  void saveSnapshot(cache);
}

export function categoryMap(data: LedgerData): Map<string, Category> {
  return new Map(data.categories.map((c) => [c.ynabId, c]));
}

export function payeeMap(data: LedgerData): Map<string, Payee> {
  return new Map(data.payees.map((p) => [p.ynabId, p]));
}

/**
 * Human payee for lists / categorize.
 * Pass a payeeId (legacy) or a full Transaction so empty-payee bank imports
 * can fall back to Plaid + credit-card payment formatting.
 */
export function resolvePayee(
  data: LedgerData,
  payeeIdOrTxn?: string | null | Transaction,
  txnMaybe?: Transaction,
): string {
  let payeeId: string | null | undefined;
  let txn: Transaction | undefined;
  if (payeeIdOrTxn && typeof payeeIdOrTxn === 'object') {
    txn = payeeIdOrTxn;
    payeeId = txn.payeeId;
  } else {
    payeeId = payeeIdOrTxn ?? null;
    txn = txnMaybe;
  }

  const named = payeeId ? payeeMap(data).get(payeeId)?.name : null;

  if (txn) {
    // Prefer Venmo Personal note over bare "Venmo" / ACH payee names.
    const display = resolveDisplayPayeeForTxn(txn, data.accounts, named);
    if (display) return display;
  }

  if (named) return named;
  if (payeeId) return 'Unknown payee';
  return '—';
}

export function resolveCategory(
  data: LedgerData,
  categoryId?: string | null,
  txn?: Transaction,
): string {
  if (txn?.transferAccountId) {
    const acct = accountMap(data).get(txn.transferAccountId);
    return acct ? `Transfer: ${resolveAccountName(acct)}` : 'Transfer';
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
    return acct ? `Transfer: ${resolveAccountName(acct)}` : 'Transfer';
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

/**
 * User-facing transaction **Status** = YNAB `approved`.
 *
 * Note: YNAB also has bank reconciliation (`cleared` / uncleared / reconciled).
 * That is a separate field — we do **not** surface it as Status. Users treat
 * Status as “have I approved this transaction?”
 */
export function formatTxnStatus(approved: boolean): string {
  return approved ? 'Approved' : 'Needs approval';
}

/** CSS suffix for status pills: pill-approved | pill-needs-approval */
export function txnStatusPillMod(approved: boolean): string {
  return approved ? 'approved' : 'needs-approval';
}

/** @deprecated use formatTxnStatus — Status is approval, not bank cleared. */
export function formatClearedLabel(
  _cleared: string,
  approved: boolean,
): string {
  return formatTxnStatus(approved);
}

export { accountTypeLabel } from './accountGroups';
