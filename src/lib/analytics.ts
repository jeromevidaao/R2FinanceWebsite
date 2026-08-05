import type {
  Account,
  Category,
  CategoryGroup,
  Payee,
  Transaction,
} from '../api/types';
import { monthKey } from './money';

/** Report period granularity (YNAB-style). */
export type PeriodMode = 'month' | 'year' | 'all';

export type RankRow = {
  id: string;
  name: string;
  amount: number;
  /** Share of total spending (0–1), outflow only. */
  share: number;
};

export type TrendPoint = {
  key: string;
  label: string;
  inflow: number;
  outflow: number;
  net: number;
  count: number;
};

export type SpendingReport = {
  mode: PeriodMode;
  periodKey: string;
  periodLabel: string;
  /** Non-transfer txns in period. */
  count: number;
  inflow: number;
  outflow: number;
  net: number;
  /** Average monthly outflow (for year/all; equals |outflow| for month). */
  avgMonthlyOutflow: number;
  monthsCovered: number;
  byCategory: RankRow[];
  byGroup: RankRow[];
  byPayee: RankRow[];
  byAccount: RankRow[];
  /** Monthly series (for year or rolling 12 / available months). */
  monthlyTrend: TrendPoint[];
  /** Yearly series (all-time / multi-year). */
  yearlyTrend: TrendPoint[];
};

export function yearKey(date: string): string {
  return date.slice(0, 4);
}

export function listMonths(transactions: Transaction[]): string[] {
  const set = new Set(
    transactions.filter((t) => !t.transferAccountId).map((t) => monthKey(t.date)),
  );
  return [...set].sort().reverse();
}

export function listYears(transactions: Transaction[]): string[] {
  const set = new Set(
    transactions.filter((t) => !t.transferAccountId).map((t) => yearKey(t.date)),
  );
  return [...set].sort().reverse();
}

export function formatPeriodLabel(mode: PeriodMode, key: string): string {
  if (mode === 'all') return 'All time';
  if (mode === 'year') return key;
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function inPeriod(date: string, mode: PeriodMode, key: string): boolean {
  if (mode === 'all') return true;
  if (mode === 'year') return yearKey(date) === key;
  return monthKey(date) === key;
}

function rank(
  map: Map<string, number>,
  nameOf: (id: string) => string,
  totalOutAbs: number,
): RankRow[] {
  return [...map.entries()]
    .filter(([, amt]) => amt < 0)
    .sort((a, b) => a[1] - b[1])
    .map(([id, amount]) => ({
      id,
      name: nameOf(id),
      amount,
      share: totalOutAbs > 0 ? Math.abs(amount) / totalOutAbs : 0,
    }));
}

function emptyTrend(key: string, label: string): TrendPoint {
  return { key, label, inflow: 0, outflow: 0, net: 0, count: 0 };
}

/**
 * Build a full spending report from ledger transactions (YNAB-style analytics).
 * Transfers are excluded from inflow/outflow and category/payee breakdowns.
 * Account breakdown uses non-transfer net activity in the period.
 */
export function buildSpendingReport(opts: {
  transactions: Transaction[];
  categories: Category[];
  groups: CategoryGroup[];
  payees: Payee[];
  accounts: Account[];
  mode: PeriodMode;
  periodKey: string;
}): SpendingReport {
  const { transactions, categories, groups, payees, accounts, mode, periodKey } =
    opts;

  const catById = new Map(categories.map((c) => [c.ynabId, c]));
  const groupById = new Map(groups.map((g) => [g.ynabId, g]));
  const payeeById = new Map(payees.map((p) => [p.ynabId, p]));
  const acctById = new Map(accounts.map((a) => [a.ynabId, a]));

  const periodTxns = transactions.filter(
    (t) => !t.transferAccountId && inPeriod(t.date, mode, periodKey),
  );

  let inflow = 0;
  let outflow = 0;
  const byCat = new Map<string, number>();
  const byGroup = new Map<string, number>();
  const byPayee = new Map<string, number>();
  const byAccount = new Map<string, number>();
  const monthBuckets = new Map<string, TrendPoint>();
  const yearBuckets = new Map<string, TrendPoint>();

  for (const t of periodTxns) {
    if (t.amount > 0) inflow += t.amount;
    if (t.amount < 0) outflow += t.amount;

    // Category / group / payee: outflows only (YNAB spending reports)
    if (t.amount < 0) {
      // Prefer split lines when present so category totals match YNAB
      const lines =
        t.subtransactions && t.subtransactions.length > 0
          ? t.subtransactions.filter((s) => s.amount < 0)
          : [{ amount: t.amount, categoryId: t.categoryId, payeeId: t.payeeId }];

      for (const line of lines) {
        const catId = line.categoryId || t.categoryId || '__uncat';
        byCat.set(catId, (byCat.get(catId) || 0) + line.amount);

        const cat = catById.get(catId);
        const gKey = cat?.categoryGroupId || '__nogroup';
        byGroup.set(gKey, (byGroup.get(gKey) || 0) + line.amount);

        const payeeId = line.payeeId || t.payeeId;
        if (payeeId) {
          byPayee.set(payeeId, (byPayee.get(payeeId) || 0) + line.amount);
        }
      }
    }

    byAccount.set(t.accountId, (byAccount.get(t.accountId) || 0) + t.amount);

    const mk = monthKey(t.date);
    const yk = yearKey(t.date);
    if (!monthBuckets.has(mk)) {
      monthBuckets.set(mk, emptyTrend(mk, formatPeriodLabel('month', mk)));
    }
    if (!yearBuckets.has(yk)) {
      yearBuckets.set(yk, emptyTrend(yk, yk));
    }
    const mb = monthBuckets.get(mk)!;
    const yb = yearBuckets.get(yk)!;
    mb.count += 1;
    yb.count += 1;
    if (t.amount > 0) {
      mb.inflow += t.amount;
      yb.inflow += t.amount;
    } else if (t.amount < 0) {
      mb.outflow += t.amount;
      yb.outflow += t.amount;
    }
    mb.net = mb.inflow + mb.outflow;
    yb.net = yb.inflow + yb.outflow;
  }

  const totalOutAbs = Math.abs(outflow);

  const byCategory = rank(byCat, (id) => {
    if (id === '__uncat') return 'Uncategorized';
    return catById.get(id)?.name || 'Unknown';
  }, totalOutAbs);

  const byGroupRows = rank(byGroup, (id) => {
    if (id === '__nogroup') return 'No group';
    return groupById.get(id)?.name || 'Unknown group';
  }, totalOutAbs);

  const byPayeeRows = rank(
    byPayee,
    (id) => payeeById.get(id)?.name || 'Unknown',
    totalOutAbs,
  ).slice(0, 40);

  // Account rows: show net activity (can be + or −)
  const byAccountRows: RankRow[] = [...byAccount.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([id, amount]) => ({
      id,
      name: acctById.get(id)?.name || 'Unknown',
      amount,
      share: totalOutAbs > 0 && amount < 0 ? Math.abs(amount) / totalOutAbs : 0,
    }));

  const monthlyTrend = [...monthBuckets.values()].sort((a, b) =>
    a.key < b.key ? -1 : 1,
  );
  const yearlyTrend = [...yearBuckets.values()].sort((a, b) =>
    a.key < b.key ? -1 : 1,
  );

  const monthsCovered = Math.max(monthlyTrend.length, mode === 'month' ? 1 : 0);
  const avgMonthlyOutflow =
    monthsCovered > 0 ? outflow / monthsCovered : outflow;

  return {
    mode,
    periodKey,
    periodLabel: formatPeriodLabel(mode, periodKey),
    count: periodTxns.length,
    inflow,
    outflow,
    net: inflow + outflow,
    avgMonthlyOutflow,
    monthsCovered: Math.max(monthsCovered, 1),
    byCategory,
    byGroup: byGroupRows,
    byPayee: byPayeeRows,
    byAccount: byAccountRows,
    monthlyTrend,
    yearlyTrend,
  };
}

/** Default period key for a mode given available data. */
export function defaultPeriodKey(
  mode: PeriodMode,
  transactions: Transaction[],
): string {
  if (mode === 'all') return 'all';
  if (mode === 'year') {
    return listYears(transactions)[0] || String(new Date().getFullYear());
  }
  return (
    listMonths(transactions)[0] ||
    monthKey(new Date().toISOString().slice(0, 10))
  );
}
