import { ledgerApi } from '../api/client';
import type {
  Account,
  Category,
  CategoryGroup,
  Payee,
  Plan,
  Stats,
  Transaction,
} from '../api/types';

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
let loading: Promise<LedgerData> | null = null;
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

export async function loadLedger(force = false): Promise<LedgerData> {
  if (cache && !force) return cache;
  if (loading && !force) return loading;

  loading = (async () => {
    const [plan, accounts, catPack, payees, transactions, stats] =
      await Promise.all([
        ledgerApi.plan(),
        ledgerApi.accounts(),
        ledgerApi.categories(),
        ledgerApi.payees(),
        ledgerApi.transactions(),
        ledgerApi.stats().catch(() => null),
      ]);

    cache = {
      plan,
      stats,
      accounts,
      groups: catPack.groups,
      categories: catPack.categories,
      payees,
      transactions: transactions.sort((a, b) =>
        a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
      ),
      loadedAt: Date.now(),
    };
    notify();
    return cache;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
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
 * Spending / to-approve list: unapproved transactions only.
 * Approve works without a category — approved rows leave this list even if
 * still uncategorized (category can be set later from the register).
 */
export function isInboxTxn(
  t: Transaction,
  _data?: LedgerData | null,
): boolean {
  return !t.approved;
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
