/**
 * Sister (offsetting) transaction pairs for Categorization.
 *
 * Examples that cancel each other (net $0):
 * - CC payment −239.35 + Transfer: Family Checking +239.35
 * - Both legs of a YNAB transfer (linked via transferTransactionId)
 *
 * Matching priority:
 * 1. Explicit transfer link (transferTransactionId → other row id)
 * 2. Equal opposite amount within a small date window (greedy)
 */

import type { Transaction } from '../api/types';

export type SisterPair<T = Transaction> = {
  /** Prefer outflow first, then inflow. */
  a: T;
  b: T;
};

export type SisterPairResult<T = Transaction> = {
  pairs: SisterPair<T>[];
  unpaired: T[];
};

/** Max calendar-day gap for amount-based sister matching. */
export const SISTER_DATE_WINDOW_DAYS = 3;

function parseYmd(date: string): number {
  // YYYY-MM-DD → UTC midnight epoch days
  const [y, m, d] = date.split('-').map((x) => Number(x));
  if (!y || !m || !d) return 0;
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function dateDiffDays(a: string, b: string): number {
  return Math.abs(parseYmd(a) - parseYmd(b));
}

export type SisterTxnAccessors<T> = {
  /** Primary stable id used for pairing / used-set. */
  id: (t: T) => string;
  /**
   * Extra ids that may appear in transferTransactionId
   * (e.g. local id vs ynabId). Primary id is always included.
   */
  altIds?: (t: T) => Array<string | null | undefined>;
  amount: (t: T) => number;
  date: (t: T) => string;
  transferTransactionId: (t: T) => string | null | undefined;
};

function orderPair<T>(
  x: T,
  y: T,
  amount: (t: T) => number,
): SisterPair<T> {
  // Outflow first so "payment −239 · transfer +239" reads naturally.
  if (amount(x) <= amount(y)) return { a: x, b: y };
  return { a: y, b: x };
}

/**
 * Generic sister-pair finder (shared shape for website Transaction and tests).
 */
export function findSisterPairsWith<T>(
  items: T[],
  acc: SisterTxnAccessors<T>,
  dateWindowDays = SISTER_DATE_WINDOW_DAYS,
): SisterPairResult<T> {
  const byId = new Map<string, T>();
  for (const t of items) {
    const id = acc.id(t);
    if (id) byId.set(id, t);
    for (const alt of acc.altIds?.(t) || []) {
      if (alt && !byId.has(alt)) byId.set(alt, t);
    }
  }

  const used = new Set<string>();
  const pairs: SisterPair<T>[] = [];

  // 1) Explicit YNAB transfer links (either direction).
  for (const t of items) {
    const id = acc.id(t);
    if (!id || used.has(id)) continue;
    const link = acc.transferTransactionId(t);
    if (!link) continue;
    const other = byId.get(link);
    if (!other) continue;
    const oid = acc.id(other);
    if (!oid || used.has(oid) || oid === id) continue;
    used.add(id);
    used.add(oid);
    pairs.push(orderPair(t, other, acc.amount));
  }

  // 2) Equal opposite amounts within date window (greedy, prefer same day).
  const remaining = items.filter((t) => {
    const id = acc.id(t);
    return id && !used.has(id);
  });
  // Newest first so recent sisters surface first when several match.
  remaining.sort((a, b) => {
    const da = acc.date(a);
    const db = acc.date(b);
    if (da < db) return 1;
    if (da > db) return -1;
    return Math.abs(acc.amount(b)) - Math.abs(acc.amount(a));
  });

  for (let i = 0; i < remaining.length; i += 1) {
    const a = remaining[i];
    const aid = acc.id(a);
    if (!aid || used.has(aid)) continue;
    const amtA = acc.amount(a);
    if (amtA === 0) continue;

    let best: T | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let j = i + 1; j < remaining.length; j += 1) {
      const b = remaining[j];
      const bid = acc.id(b);
      if (!bid || used.has(bid)) continue;
      if (acc.amount(a) + acc.amount(b) !== 0) continue;
      const days = dateDiffDays(acc.date(a), acc.date(b));
      if (days > dateWindowDays) continue;
      // Prefer same date; slight tie-break keeps stable pairing.
      const score = days * 1000 + j;
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }

    if (best) {
      const bid = acc.id(best);
      used.add(aid);
      used.add(bid);
      pairs.push(orderPair(a, best, acc.amount));
    }
  }

  // Newest pair first (by later of the two dates).
  pairs.sort((p, q) => {
    const pDate =
      acc.date(p.a) >= acc.date(p.b) ? acc.date(p.a) : acc.date(p.b);
    const qDate =
      acc.date(q.a) >= acc.date(q.b) ? acc.date(q.a) : acc.date(q.b);
    if (pDate < qDate) return 1;
    if (pDate > qDate) return -1;
    return 0;
  });

  const unpaired = items.filter((t) => {
    const id = acc.id(t);
    return !id || !used.has(id);
  });

  return { pairs, unpaired };
}

const TXN_ACCESSORS: SisterTxnAccessors<Transaction> = {
  id: (t) => t.ynabId || t.id || t.clientId || '',
  altIds: (t) => [t.id, t.clientId, t.ynabId],
  amount: (t) => t.amount,
  date: (t) => t.date,
  transferTransactionId: (t) => t.transferTransactionId,
};

export function findSisterPairs(
  items: Transaction[],
  dateWindowDays = SISTER_DATE_WINDOW_DAYS,
): SisterPairResult<Transaction> {
  return findSisterPairsWith(items, TXN_ACCESSORS, dateWindowDays);
}

/** Flatten pairs as [a1,b1,a2,b2,…] for list display. */
export function flattenSisterPairs<T>(pairs: SisterPair<T>[]): T[] {
  const out: T[] = [];
  for (const p of pairs) {
    out.push(p.a, p.b);
  }
  return out;
}

/** True when this index is the first row of a sister pair (even index). */
export function isSisterPairStart(index: number): boolean {
  return index % 2 === 0;
}

/** True when this index is the second (closing) row of a sister pair. */
export function isSisterPairEnd(index: number): boolean {
  return index % 2 === 1;
}
