import type {
  Account,
  Category,
  CategoryGroup,
  Payee,
  Transaction,
} from '../api/types';
import { monthKey } from './money';

/** Report period: single month, calendar year, all time, or named preset. */
export type PeriodMode = 'month' | 'year' | 'all' | 'preset';

export type PresetId =
  | 'last3'
  | 'last6'
  | 'last12'
  | 'ytd'
  | 'lastYear'
  | 'all';

export const PRESET_OPTIONS: { id: PresetId; label: string }[] = [
  { id: 'last3', label: 'Last 3 Months' },
  { id: 'last6', label: 'Last 6 Months' },
  { id: 'last12', label: 'Last 12 Months' },
  { id: 'ytd', label: 'Year to Date' },
  { id: 'lastYear', label: 'Last Year' },
  { id: 'all', label: 'All Dates' },
];

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
  /** Monthly series within the selected period. */
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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(y: number, m0: number, d: number): string {
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
}

function lastDayOfMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/** Inclusive date bounds for a report period. null from/to = unbounded side. */
export function resolveDateBounds(
  mode: PeriodMode,
  periodKey: string,
  now = new Date(),
): { from: string | null; to: string | null; label: string } {
  const y = now.getFullYear();
  const m0 = now.getMonth();

  if (mode === 'all' || (mode === 'preset' && periodKey === 'all')) {
    return { from: null, to: null, label: 'All Dates' };
  }
  if (mode === 'month') {
    const [yy, mm] = periodKey.split('-').map(Number);
    if (!yy || !mm) return { from: null, to: null, label: periodKey };
    const from = ymd(yy, mm - 1, 1);
    const to = ymd(yy, mm - 1, lastDayOfMonth(yy, mm - 1));
    return { from, to, label: formatPeriodLabel('month', periodKey) };
  }
  if (mode === 'year') {
    const yy = Number(periodKey) || y;
    return {
      from: ymd(yy, 0, 1),
      to: ymd(yy, 11, 31),
      label: String(yy),
    };
  }
  // presets
  const preset = periodKey as PresetId;
  if (preset === 'ytd') {
    return {
      from: ymd(y, 0, 1),
      to: ymd(y, m0, lastDayOfMonth(y, m0)),
      label: 'Year to Date',
    };
  }
  if (preset === 'lastYear') {
    return {
      from: ymd(y - 1, 0, 1),
      to: ymd(y - 1, 11, 31),
      label: 'Last Year',
    };
  }
  const n =
    preset === 'last3' ? 3 : preset === 'last6' ? 6 : preset === 'last12' ? 12 : 3;
  // Inclusive of current month → go back (n - 1) months
  const start = new Date(Date.UTC(y, m0 - (n - 1), 1));
  const from = ymd(start.getUTCFullYear(), start.getUTCMonth(), 1);
  const to = ymd(y, m0, lastDayOfMonth(y, m0));
  const label =
    PRESET_OPTIONS.find((p) => p.id === preset)?.label || `Last ${n} Months`;
  return { from, to, label };
}

export function formatPeriodLabel(mode: PeriodMode, key: string): string {
  if (mode === 'all') return 'All Dates';
  if (mode === 'year') return key;
  if (mode === 'preset') {
    return PRESET_OPTIONS.find((p) => p.id === key)?.label || key;
  }
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function inBounds(
  date: string,
  from: string | null,
  to: string | null,
): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
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
 */
export function buildSpendingReport(opts: {
  transactions: Transaction[];
  categories: Category[];
  groups: CategoryGroup[];
  payees: Payee[];
  accounts: Account[];
  mode: PeriodMode;
  periodKey: string;
  /** Optional clock override for presets (tests). */
  now?: Date;
}): SpendingReport {
  const {
    transactions,
    categories,
    groups,
    payees,
    accounts,
    mode,
    periodKey,
    now,
  } = opts;

  const bounds = resolveDateBounds(mode, periodKey, now ?? new Date());
  const catById = new Map(categories.map((c) => [c.ynabId, c]));
  const groupById = new Map(groups.map((g) => [g.ynabId, g]));
  const payeeById = new Map(payees.map((p) => [p.ynabId, p]));
  const acctById = new Map(accounts.map((a) => [a.ynabId, a]));

  const periodTxns = transactions.filter(
    (t) =>
      !t.transferAccountId && inBounds(t.date, bounds.from, bounds.to),
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

    if (t.amount < 0) {
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
    periodLabel: bounds.label,
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

/** Last N calendar months ending at `endYm` (YYYY-MM), chronological. */
export function lastNMonthKeys(endYm: string, n: number): string[] {
  const [y, m] = endYm.split('-').map(Number);
  if (!y || !m) return [];
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(
      `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`,
    );
  }
  return keys;
}

/** Insight for income vs spending over trend points. */
export function incomeVsSpendingInsight(points: TrendPoint[]): string {
  if (points.length === 0) return 'Not enough activity yet to compare income and spending.';
  const avgIn =
    points.reduce((s, p) => s + p.inflow, 0) / points.length;
  const avgOut =
    points.reduce((s, p) => s + Math.abs(p.outflow), 0) / points.length;
  if (avgOut > avgIn * 1.02) {
    return "On average, you're spending more than you make.";
  }
  if (avgIn > avgOut * 1.02) {
    return "On average, you're making more than you spend.";
  }
  return "On average, income and spending are roughly balanced.";
}

/** Default period key for a mode given available data. */
export function defaultPeriodKey(
  mode: PeriodMode,
  transactions: Transaction[],
): string {
  if (mode === 'all') return 'all';
  if (mode === 'preset') return 'last3';
  if (mode === 'year') {
    return listYears(transactions)[0] || String(new Date().getFullYear());
  }
  return (
    listMonths(transactions)[0] ||
    monthKey(new Date().toISOString().slice(0, 10))
  );
}

/** Current calendar month key (YYYY-MM). */
export function currentMonthKey(now = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}
