/**
 * Category chip visuals for Spending / categorize UI.
 * Icons are seeded by name (YNAB categories have no icon field).
 */

import type { Transaction } from '../api/types';
import type { LedgerData } from './dataStore';
import { categoryMap } from './dataStore';

export type CategoryChipKind = 'needed' | 'inflow' | 'category' | 'transfer';

export type CategoryChip = {
  label: string;
  kind: CategoryChipKind;
  /** Small leading icon (emoji). */
  icon: string;
};

const ICON_RULES: { re: RegExp; icon: string }[] = [
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
  { re: /travel|hotel|flight|airline|vacation|airbnb/i, icon: '✈️' },
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

export function iconForCategoryName(
  name: string | null | undefined,
  groupName?: string | null,
): string {
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
    };
  }

  if (!t.categoryId) {
    return { label: 'Category Needed', kind: 'needed', icon: '⚠️' };
  }

  const cat = categoryMap(data).get(t.categoryId);
  const group = cat?.categoryGroupId
    ? data.groups.find((g) => g.ynabId === cat.categoryGroupId)
    : undefined;
  const name = cat?.name || 'Unknown category';

  if (name.toLowerCase() === 'uncategorized') {
    return { label: 'Category Needed', kind: 'needed', icon: '⚠️' };
  }

  if (name.toLowerCase().includes('credit card payment')) {
    return {
      label: 'Credit Card Payment',
      kind: 'category',
      icon: '💳',
    };
  }

  // Income / inflow categories → green; positive amount without expense group → green.
  const treatAsInflow =
    isInflowCategoryName(name, group?.name) ||
    (t.amount > 0 &&
      !/expense|spend|bills|monthly|yearly|debt/i.test(group?.name || ''));

  return {
    label: name,
    kind: treatAsInflow ? 'inflow' : 'category',
    icon: iconForCategoryName(name, group?.name),
  };
}

/** Chip for a bare category in the picker list. */
export function categoryChipForCategory(
  categoryName: string,
  groupName?: string | null,
): CategoryChip {
  const inflow = isInflowCategoryName(categoryName, groupName);
  return {
    label: categoryName,
    kind: inflow ? 'inflow' : 'category',
    icon: iconForCategoryName(categoryName, groupName),
  };
}
