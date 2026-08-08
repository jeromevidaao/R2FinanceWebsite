import type { Transaction } from '../api/types';

/** How a ledger row most likely entered the cloud ledger. */
export type TxnSource = 'ynab' | 'r2';

export type InfluxDay = {
  /** YYYY-MM-DD (UTC calendar day of txn.date) */
  key: string;
  /** Short axis label (e.g. "3/12") */
  label: string;
  /** Full tooltip date */
  fullLabel: string;
  /** Count of inflows (amount > 0) */
  inCount: number;
  /** Count of outflows (amount < 0) */
  outCount: number;
  /** Milliunits coming in */
  inflow: number;
  /** Milliunits going out (negative or zero) */
  outflow: number;
  /** Count classified as YNAB-origin */
  ynabCount: number;
  /** Count classified as R2Finance / device-origin */
  r2Count: number;
  /** Absolute milliunits from YNAB-origin rows (sum of |amount|) */
  ynabAmount: number;
  /** Absolute milliunits from R2-origin rows (sum of |amount|) */
  r2Amount: number;
  totalCount: number;
};

export type InfluxSeries = {
  days: number;
  from: string;
  to: string;
  buckets: InfluxDay[];
  totals: {
    inCount: number;
    outCount: number;
    inflow: number;
    outflow: number;
    ynabCount: number;
    r2Count: number;
    totalCount: number;
    net: number;
  };
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local calendar YYYY-MM-DD from a Date. */
export function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseYmdLocal(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatShort(ymd: string): string {
  const d = parseYmdLocal(ymd);
  return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

function formatFull(ymd: string): string {
  const d = parseYmdLocal(ymd);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Classify origin for the influx chart.
 *
 * - R2Finance: device / app path stamped a stable `clientId` (create or edit
 *   via `/v1/device/push`). Also covers rows still pending a real YNAB id.
 * - YNAB: pure pull from the YNAB bridge (no clientId) — bank imports +
 *   anything that only ever lived in YNAB before DDB.
 */
export function classifyTxnSource(t: Transaction): TxnSource {
  const clientId = (t.clientId || '').trim();
  if (!clientId) return 'ynab';
  // clientId set and equal to ynabId is typical for not-yet-pushed device rows
  // and for R2-created rows that kept the client key as the public id.
  return 'r2';
}

function emptyDay(key: string): InfluxDay {
  return {
    key,
    label: formatShort(key),
    fullLabel: formatFull(key),
    inCount: 0,
    outCount: 0,
    inflow: 0,
    outflow: 0,
    ynabCount: 0,
    r2Count: 0,
    ynabAmount: 0,
    r2Amount: 0,
    totalCount: 0,
  };
}

/**
 * Build a contiguous daily histogram for the last `days` calendar days
 * (inclusive of today), from ledger transactions.
 *
 * Primary use (More page): **API intake counts** — `ynabCount` / `r2Count`
 * per day (which path brought the row into DDB). Money fields (`inflow` /
 * `outflow` / `*Amount`) are still computed for other callers but the UI
 * chart is counts-only.
 *
 * Excludes soft-deleted rows and zero-amount noise. Transfers are included
 * (they still count as ledger influx).
 */
export function buildTxnInflux(
  transactions: Transaction[],
  opts: { days?: number; now?: Date } = {},
): InfluxSeries {
  const days = Math.max(1, Math.min(366, opts.days ?? 90));
  const now = opts.now ?? new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));

  const from = ymdLocal(start);
  const to = ymdLocal(end);

  const buckets: InfluxDay[] = [];
  const byKey = new Map<string, InfluxDay>();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = ymdLocal(d);
    const b = emptyDay(key);
    buckets.push(b);
    byKey.set(key, b);
  }

  const totals = {
    inCount: 0,
    outCount: 0,
    inflow: 0,
    outflow: 0,
    ynabCount: 0,
    r2Count: 0,
    totalCount: 0,
    net: 0,
  };

  for (const t of transactions) {
    if (t.deleted) continue;
    const date = (t.date || '').slice(0, 10);
    if (!date || date < from || date > to) continue;
    const b = byKey.get(date);
    if (!b) continue;

    const amt = Number(t.amount) || 0;
    if (amt === 0) continue;

    const source = classifyTxnSource(t);
    b.totalCount += 1;
    totals.totalCount += 1;

    if (amt > 0) {
      b.inCount += 1;
      b.inflow += amt;
      totals.inCount += 1;
      totals.inflow += amt;
    } else {
      b.outCount += 1;
      b.outflow += amt;
      totals.outCount += 1;
      totals.outflow += amt;
    }

    // Source series uses absolute volume so mixed in/out days don't cancel.
    const abs = Math.abs(amt);
    if (source === 'ynab') {
      b.ynabCount += 1;
      b.ynabAmount += abs;
      totals.ynabCount += 1;
    } else {
      b.r2Count += 1;
      b.r2Amount += abs;
      totals.r2Count += 1;
    }
  }

  totals.net = totals.inflow + totals.outflow;

  return { days, from, to, buckets, totals };
}

/** One calendar day of successful R2 → YNAB writes (lastPushedAt). */
export type OutboundDay = {
  key: string;
  label: string;
  fullLabel: string;
  /** Rows whose last successful YNAB write fell on this day */
  count: number;
};

export type OutboundSeries = {
  days: number;
  from: string;
  to: string;
  buckets: OutboundDay[];
  totals: {
    /** Successful YNAB writes in window (by lastPushedAt) */
    pushedCount: number;
    /** Currently waiting in DDB PENDING_PUSH queue */
    pendingCount: number;
    /** Rows with lastPushedAt ever (any age) */
    everPushedCount: number;
  };
};

/**
 * Histogram of **outbound** YNAB sync (category / approve / device-create
 * that landed in YNAB), keyed by `lastPushedAt` calendar day — not txn.date.
 *
 * Separate from intake (`buildTxnInflux`): categorizing a YNAB-imported row
 * does **not** change its origin bar; it stamps lastPushedAt here instead.
 */
export function buildYnabOutbound(
  transactions: Transaction[],
  opts: { days?: number; now?: Date } = {},
): OutboundSeries {
  const days = Math.max(1, Math.min(366, opts.days ?? 90));
  const now = opts.now ?? new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));

  const from = ymdLocal(start);
  const to = ymdLocal(end);

  const buckets: OutboundDay[] = [];
  const byKey = new Map<string, OutboundDay>();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = ymdLocal(d);
    const b: OutboundDay = {
      key,
      label: formatShort(key),
      fullLabel: formatFull(key),
      count: 0,
    };
    buckets.push(b);
    byKey.set(key, b);
  }

  let pushedCount = 0;
  let pendingCount = 0;
  let everPushedCount = 0;

  for (const t of transactions) {
    if (t.deleted) continue;
    const status = (t.syncStatus || '').toUpperCase();
    if (status === 'PENDING_PUSH') pendingCount += 1;

    const lp = Number(t.lastPushedAt) || 0;
    if (lp <= 0) continue;
    everPushedCount += 1;
    const day = ymdLocal(new Date(lp));
    if (day < from || day > to) continue;
    const b = byKey.get(day);
    if (!b) continue;
    b.count += 1;
    pushedCount += 1;
  }

  return {
    days,
    from,
    to,
    buckets,
    totals: { pushedCount, pendingCount, everPushedCount },
  };
}
