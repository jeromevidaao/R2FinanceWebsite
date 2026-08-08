/**
 * Category chip visuals for Spending / categorize UI.
 * Icons are seeded by name (YNAB categories have no icon field).
 * Airbnb categories use brand red + logo.
 */

import type { Transaction } from '../api/types';
import type { LedgerData } from './dataStore';
import { categoryMap } from './dataStore';
import {
  CATEGORY_PALETTE,
  INCOME_COLOR,
  UNCATEGORIZED_COLOR,
  isHexColor,
} from './categoryColors';
import { findSisterPairs, flattenSisterPairs } from './sisterPairs';

export type CategoryChipKind =
  | 'needed'
  | 'inflow'
  | 'category'
  | 'transfer'
  | 'sister'
  | 'airbnb';

export type CategoryChip = {
  label: string;
  kind: CategoryChipKind;
  /** Small leading icon (emoji). Empty when brandIcon is set. */
  icon: string;
  /** Use Airbnb (or other) brand mark instead of emoji. */
  brandIcon?: 'airbnb';
  /** Hex rail / accent color for group stripe. */
  railColor: string;
};

/** Airbnb brand (Rausch / classic coral). */
export const AIRBNB_COLOR = '#FF5A5F';
export const NEEDED_COLOR = '#F59E0B';
export const TRANSFER_COLOR = '#A78BFA';
/** Offsetting sister pairs (CC payment ↔ transfer, both legs of a transfer). */
export const SISTER_COLOR = '#38BDF8';

const ICON_RULES: { re: RegExp; icon: string }[] = [
  // Airbnb handled separately for brand logo + color.
  { re: /grocer|food|supermarket|market/i, icon: '🛒' },
  { re: /restaurant|dining|coffee|cafe|takeout|fast.?food/i, icon: '🍽️' },
  { re: /gas|fuel|parking|auto|car |vehicle|uber|lyft|transit|transport/i, icon: '⛽' },
  { re: /rent|mortgage|housing|hoa|home|apartment/i, icon: '🏠' },
  { re: /utilit|electric|water|gas bill|internet|phone|cable/i, icon: '💡' },
  { re: /income|salary|paycheck|payroll|wages|deposit|interest|dividend|refund/i, icon: '💰' },
  { re: /inflow|ready to assign|to be budgeted/i, icon: '💵' },
  { re: /medical|health|doctor|dental|pharmacy|hospital/i, icon: '🏥' },
  { re: /entertain|movie|music|game|hobby|netflix|spotify/i, icon: '🎬' },
  { re: /shop|amazon|clothing|clothes|retail/i, icon: '🛍️' },
  { re: /travel|hotel|flight|airline|vacation/i, icon: '✈️' },
  { re: /educat|tuition|school|student|books/i, icon: '📚' },
  { re: /insur/i, icon: '🛡️' },
  { re: /credit card payment|cc payment/i, icon: '💳' },
  { re: /transfer/i, icon: '↔️' },
  { re: /subscri|software|saas|app store/i, icon: '📱' },
  { re: /pet|vet|dog|cat/i, icon: '🐾' },
  { re: /gift|donation|charit/i, icon: '🎁' },
  { re: /personal|care|hair|spa|gym|fitness/i, icon: '💅' },
  { re: /tax/i, icon: '🧾' },
  { re: /child|kids|baby/i, icon: '🧸' },
  { re: /savings|invest/i, icon: '📈' },
];

export function isAirbnbName(
  name: string | null | undefined,
  groupName?: string | null,
): boolean {
  const hay = `${name || ''} ${groupName || ''}`.toLowerCase();
  return hay.includes('airbnb');
}

export function iconForCategoryName(
  name: string | null | undefined,
  groupName?: string | null,
): string {
  if (isAirbnbName(name, groupName)) return ''; // brand icon used instead
  const hay = `${name || ''} ${groupName || ''}`.trim();
  if (!hay) return '⚠️';
  for (const rule of ICON_RULES) {
    if (rule.re.test(hay)) return rule.icon;
  }
  return '🏷️';
}

export function isInflowCategoryName(
  categoryName: string | null | undefined,
  groupName?: string | null,
): boolean {
  const g = (groupName || '').toLowerCase();
  const c = (categoryName || '').toLowerCase();
  if (!c && !g) return false;
  if (g.includes('inflow') || g.includes('income')) return true;
  if (c.includes('income') || c.includes('inflow')) return true;
  if (c.includes('salary') || c.includes('paycheck') || c.includes('payroll')) return true;
  if (c.includes('ready to assign') || c.includes('to be budgeted')) return true;
  if (c.includes('interest') || c.includes('dividend')) return true;
  return false;
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable rail color for a category id / name. */
export function railColorForCategory(
  categoryId: string | null | undefined,
  categoryName: string | null | undefined,
  groupName: string | null | undefined,
  storedColor: string | null | undefined,
  opts?: { transfer?: boolean; amount?: number },
): string {
  if (opts?.transfer) return TRANSFER_COLOR;
  if (!categoryId || !categoryName || /uncategor/i.test(categoryName)) {
    return NEEDED_COLOR;
  }
  if (isAirbnbName(categoryName, groupName)) return AIRBNB_COLOR;
  if (isHexColor(storedColor)) return storedColor;
  if (isInflowCategoryName(categoryName, groupName)) return INCOME_COLOR;
  if (
    opts?.amount != null &&
    opts.amount > 0 &&
    !/expense|spend|bills|monthly|yearly|debt/i.test(groupName || '')
  ) {
    return INCOME_COLOR;
  }
  return CATEGORY_PALETTE[hashId(categoryId) % CATEGORY_PALETTE.length];
}

export function categoryChipForTxn(
  data: LedgerData,
  t: Transaction,
): CategoryChip {
  if (t.transferAccountId) {
    const acct = data.accounts.find((a) => a.ynabId === t.transferAccountId);
    return {
      label: acct ? `Transfer: ${acct.name}` : 'Transfer',
      kind: 'transfer',
      icon: '↔️',
      railColor: TRANSFER_COLOR,
    };
  }

  if (!t.categoryId) {
    return {
      label: 'Category Needed',
      kind: 'needed',
      icon: '⚠️',
      railColor: NEEDED_COLOR,
    };
  }

  const cat = categoryMap(data).get(t.categoryId);
  const group = cat?.categoryGroupId
    ? data.groups.find((g) => g.ynabId === cat.categoryGroupId)
    : undefined;
  const name = cat?.name || 'Unknown category';

  if (name.toLowerCase() === 'uncategorized') {
    return {
      label: 'Category Needed',
      kind: 'needed',
      icon: '⚠️',
      railColor: NEEDED_COLOR,
    };
  }

  const rail = railColorForCategory(
    t.categoryId,
    name,
    group?.name,
    cat?.color,
    { amount: t.amount },
  );

  if (isAirbnbName(name, group?.name)) {
    return {
      label: name,
      kind: 'airbnb',
      icon: '',
      brandIcon: 'airbnb',
      railColor: AIRBNB_COLOR,
    };
  }

  if (name.toLowerCase().includes('credit card payment')) {
    return {
      label: 'Credit Card Payment',
      kind: 'category',
      icon: '💳',
      railColor: rail,
    };
  }

  const treatAsInflow =
    isInflowCategoryName(name, group?.name) ||
    (t.amount > 0 &&
      !/expense|spend|bills|monthly|yearly|debt/i.test(group?.name || ''));

  return {
    label: name,
    kind: treatAsInflow ? 'inflow' : 'category',
    icon: iconForCategoryName(name, group?.name),
    railColor: treatAsInflow ? INCOME_COLOR : rail,
  };
}

/** Chip for a bare category in the picker list. */
export function categoryChipForCategory(
  categoryName: string,
  groupName?: string | null,
  categoryId?: string | null,
  storedColor?: string | null,
): CategoryChip {
  if (isAirbnbName(categoryName, groupName)) {
    return {
      label: categoryName,
      kind: 'airbnb',
      icon: '',
      brandIcon: 'airbnb',
      railColor: AIRBNB_COLOR,
    };
  }
  const inflow = isInflowCategoryName(categoryName, groupName);
  return {
    label: categoryName,
    kind: inflow ? 'inflow' : 'category',
    icon: iconForCategoryName(categoryName, groupName),
    railColor: railColorForCategory(
      categoryId || categoryName,
      categoryName,
      groupName,
      storedColor,
    ),
  };
}

/** Stable group key for Spending list (same category together). */
export function inboxGroupKey(t: Transaction): string {
  if (t.transferAccountId) return `__transfer:${t.transferAccountId}`;
  if (!t.categoryId) return '__needed';
  return t.categoryId;
}

export type InboxCategoryGroup = {
  key: string;
  label: string;
  chip: CategoryChip;
  railColor: string;
  transactions: Transaction[];
  /**
   * When true, transactions are ordered as sister pairs [a1,b1,a2,b2,…]
   * (equal opposite amounts that cancel).
   */
  sisterPairs?: boolean;
  /** Number of sister pairs when sisterPairs is true. */
  pairCount?: number;
};

const SISTERS_KEY = '__sisters';

function sisterPairsChip(pairCount: number): CategoryChip {
  return {
    label:
      pairCount === 1
        ? 'Sister pair · net $0'
        : `Sister pairs · ${pairCount} · net $0`,
    kind: 'sister',
    icon: '⚖️',
    railColor: SISTER_COLOR,
  };
}

/**
 * Group unapproved/inbox rows for bulk approve.
 * Order: Sister pairs (cancel out) → Category Needed → named categories (A–Z) → transfers.
 * Within each category group: newest date first.
 * Sister group: pairs listed consecutively (outflow then inflow).
 */
export function groupInboxByCategory(
  data: LedgerData,
  items: Transaction[],
): InboxCategoryGroup[] {
  const { pairs, unpaired } = findSisterPairs(items);
  const groups: InboxCategoryGroup[] = [];

  if (pairs.length > 0) {
    const chip = sisterPairsChip(pairs.length);
    groups.push({
      key: SISTERS_KEY,
      label: chip.label,
      chip,
      railColor: chip.railColor,
      transactions: flattenSisterPairs(pairs),
      sisterPairs: true,
      pairCount: pairs.length,
    });
  }

  const map = new Map<string, Transaction[]>();
  for (const t of unpaired) {
    const key = inboxGroupKey(t);
    const list = map.get(key) || [];
    list.push(t);
    map.set(key, list);
  }

  for (const [key, txns] of map.entries()) {
    const sorted = [...txns].sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
    );
    const sample = sorted[0];
    const chip = categoryChipForTxn(data, sample);
    groups.push({
      key,
      label: chip.label,
      chip,
      railColor: chip.railColor,
      transactions: sorted,
    });
  }

  groups.sort((a, b) => {
    const rank = (g: InboxCategoryGroup) => {
      if (g.key === SISTERS_KEY) return 0;
      if (g.key === '__needed') return 1;
      if (g.key.startsWith('__transfer')) return 3;
      return 2;
    };
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });

  return groups;
}

// re-export for convenience
export { UNCATEGORIZED_COLOR };
