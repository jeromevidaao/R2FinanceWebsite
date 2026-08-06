/**
 * YNAB-style account grouping + institution branding for Accounts screen.
 * Cash / Credit / Tracking match the YNAB app layout.
 */

export type AccountGroupKey = 'cash' | 'credit' | 'tracking';

export interface AccountGroupMeta {
  key: AccountGroupKey;
  title: string;
  /** Sort order for sections */
  order: number;
}

export const ACCOUNT_GROUPS: AccountGroupMeta[] = [
  { key: 'cash', title: 'Cash', order: 0 },
  { key: 'credit', title: 'Credit', order: 1 },
  { key: 'tracking', title: 'Tracking', order: 2 },
];

const CASH_TYPES = new Set(['checking', 'savings', 'cash']);
const CREDIT_TYPES = new Set(['creditCard', 'lineOfCredit']);

/** Map YNAB account type + onBudget → Cash | Credit | Tracking. */
export function accountGroupKey(
  type: string,
  onBudget: boolean,
): AccountGroupKey {
  const t = type || 'checking';
  if (onBudget && CASH_TYPES.has(t)) return 'cash';
  if (onBudget && CREDIT_TYPES.has(t)) return 'credit';
  // Off-budget assets/liabilities + any remaining on-budget loans → Tracking
  return 'tracking';
}

export type InstitutionId =
  | 'boa'
  | 'chase'
  | 'vanguard'
  | 'amazon'
  | 'generic_cash'
  | 'generic_credit'
  | 'generic_tracking';

export interface InstitutionBrand {
  id: InstitutionId;
  /** Short mark shown in the icon circle */
  mark: string;
  /** Accessible label */
  label: string;
  /** CSS background */
  bg: string;
  /** CSS foreground */
  fg: string;
}

const BRANDS: Record<InstitutionId, InstitutionBrand> = {
  boa: {
    id: 'boa',
    mark: 'BoA',
    label: 'Bank of America',
    bg: '#012169',
    fg: '#e31837',
  },
  chase: {
    id: 'chase',
    mark: 'C',
    label: 'Chase',
    bg: '#117aca',
    fg: '#ffffff',
  },
  vanguard: {
    id: 'vanguard',
    mark: 'V',
    label: 'Vanguard',
    bg: '#96000e',
    fg: '#ffffff',
  },
  amazon: {
    id: 'amazon',
    mark: 'a',
    label: 'Amazon',
    bg: '#232f3e',
    fg: '#ff9900',
  },
  generic_cash: {
    id: 'generic_cash',
    mark: '$',
    label: 'Cash account',
    bg: '#1f6f4a',
    fg: '#d8f3e4',
  },
  generic_credit: {
    id: 'generic_credit',
    mark: 'CC',
    label: 'Credit card',
    bg: '#3d4a63',
    fg: '#e8eef6',
  },
  generic_tracking: {
    id: 'generic_tracking',
    mark: '📈',
    label: 'Tracking account',
    bg: '#4a3d63',
    fg: '#e8eef6',
  },
};

/**
 * Infer institution from account nickname (YNAB does not send brand codes).
 * Keep heuristics conservative — wrong brand is worse than generic.
 */
export function inferInstitution(
  name: string,
  type: string,
  onBudget: boolean,
): InstitutionBrand {
  const n = name.toLowerCase();

  if (
    /\bboa\b/.test(n) ||
    n.includes('bank of america') ||
    n.includes('checkin') ||
    n.includes('checking')
  ) {
    // "checking" alone is weak; prefer BoA only for known BoA nicknames
    if (
      /\bboa\b/.test(n) ||
      n.includes('bank of america') ||
      n.includes('checkin')
    ) {
      return BRANDS.boa;
    }
  }

  if (
    n.includes('chase') ||
    n.includes('ink ') ||
    n.startsWith('ink ') ||
    n.includes('freedom') ||
    n.includes('reserve') ||
    n.includes('mai/tri') ||
    n.includes('sapphire')
  ) {
    return BRANDS.chase;
  }

  if (n.includes('vanguard') || /\b529\b/.test(n)) {
    return BRANDS.vanguard;
  }

  // Amazon card, 401(k), RSU — not "Amazon" substring in random words
  if (
    n.includes('amazon') ||
    n.includes('401') ||
    n.includes('rsu') ||
    /^amazon\b/.test(n)
  ) {
    return BRANDS.amazon;
  }

  const group = accountGroupKey(type, onBudget);
  if (group === 'cash') return BRANDS.generic_cash;
  if (group === 'credit') return BRANDS.generic_credit;
  return BRANDS.generic_tracking;
}

export function accountTypeLabel(type: string): string {
  const map: Record<string, string> = {
    checking: 'Checking',
    savings: 'Savings',
    cash: 'Cash',
    creditCard: 'Credit Card',
    lineOfCredit: 'Line of Credit',
    otherAsset: 'Asset',
    otherLiability: 'Liability',
    mortgage: 'Mortgage',
    autoLoan: 'Auto Loan',
    studentLoan: 'Student Loan',
    personalLoan: 'Personal Loan',
    medicalDebt: 'Medical Debt',
    otherDebt: 'Other Debt',
  };
  return map[type] || type;
}
