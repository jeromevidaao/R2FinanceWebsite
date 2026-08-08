export type Milli = number;

export interface Plan {
  name: string;
  ynabPlanId?: string | null;
  currency: string;
  serverKnowledge: number;
}

export interface Account {
  ynabId: string;
  name: string;
  type: string;
  balance: Milli;
  onBudget: boolean;
  closed: boolean;
  note?: string | null;
  transferPayeeId?: string | null;
  /**
   * Display nickname (R2Finance-only). Seeded from YNAB account `name` until
   * the user saves a custom value. Prefer over `name` via resolveAccountName.
   */
  alias?: string | null;
  /**
   * true when the user saved a custom nickname (survives YNAB renames).
   * false / missing means the alias is (or will be) mirrored from YNAB name.
   */
  aliasUserSet?: boolean;
  /** Last-4 digits when present in the YNAB account name. */
  mask?: string | null;
}

export interface CategoryGroup {
  ynabId: string;
  name: string;
  hidden: boolean;
}

export interface Category {
  ynabId: string;
  name: string;
  categoryGroupId?: string | null;
  hidden: boolean;
  /** Hex color from DDB (Reflect / charts). */
  color?: string | null;
}

export interface Payee {
  ynabId: string;
  name: string;
  transferAccountId?: string | null;
}

export interface SubTransaction {
  ynabId?: string | null;
  amount: Milli;
  payeeId?: string | null;
  categoryId?: string | null;
  memo?: string | null;
  /** Present when this split leg is a transfer (exclude from Reflect spending). */
  transferAccountId?: string | null;
}

export interface TransactionLocation {
  address?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
  country?: string | null;
  lat?: number | null;
  lon?: number | null;
  store_number?: string | null;
  text?: string | null;
}

export interface Transaction {
  /** Stable client key when present (device-created rows). */
  id?: string;
  clientId?: string | null;
  ynabId: string;
  accountId: string;
  date: string;
  amount: Milli;
  payeeId?: string | null;
  categoryId?: string | null;
  memo?: string | null;
  cleared: string;
  approved: boolean;
  flagColor?: string | null;
  transferAccountId?: string | null;
  transferTransactionId?: string | null;
  importId?: string | null;
  /** Bank-feed payee when YNAB payeeId is still empty (parsed, not match JSON). */
  importPayeeName?: string | null;
  /** Soft-delete tombstone from delta sync. */
  deleted?: boolean;
  updatedAt?: number;
  /** DDB bridge status: PENDING_PUSH | SYNCED | … */
  syncStatus?: string | null;
  /** Epoch ms of last successful write to YNAB (category / approve / create). */
  lastPushedAt?: number | null;
  subtransactions: SubTransaction[];
  /** Plaid match + location (from cloud enrich). */
  plaidTransactionId?: string | null;
  plaidMerchantName?: string | null;
  plaidPaymentChannel?: string | null;
  plaidPfc?: string | null;
  matchTier?: string | null;
  matchConfidence?: number | null;
  location?: TransactionLocation | null;
  locationSource?: string | null;
  /** UI: "City, ST" (US) or "City, Country" (intl). */
  locationDisplay?: string | null;
  enrichedAt?: string | null;
  /** Inbox-only extras */
  accountName?: string | null;
  payeeName?: string | null;
  reason?: string | null;
}

/** Response from GET /v1/sync/changes */
export interface SyncChanges {
  mode: 'full' | 'delta' | string;
  serverTime: number;
  cursor: number;
  since: number;
  /** Present on first page only when paged. */
  plan: Plan | null;
  accounts: Array<Account & { deleted?: boolean; updatedAt?: number }>;
  groups: Array<CategoryGroup & { deleted?: boolean; updatedAt?: number }>;
  categories: Array<Category & { deleted?: boolean; updatedAt?: number }>;
  payees: Array<Payee & { deleted?: boolean; updatedAt?: number }>;
  transactions: Transaction[];
  /** True when more transaction pages remain — do not advance local cursor yet. */
  hasMore?: boolean;
  txnOffset?: number;
  nextTxnOffset?: number;
  txnLimit?: number;
  txnTotal?: number;
  counts?: {
    accounts: number;
    groups: number;
    categories: number;
    payees: number;
    transactions: number;
    txnTotal?: number;
  };
}

export interface Stats {
  itemCount: number;
  byType: Record<string, number>;
  planName?: string;
  ynabPlanId?: string;
  serverKnowledge?: number;
  /** Authoritative needs-attention counts from GET /v1/stats → listInbox. */
  inbox?: {
    count: number;
    unapproved: number;
    uncategorized: number;
    error?: string;
  } | null;
}

/** Response from GET /v1/inbox (YNAB-style needs-attention). */
export interface InboxResponse {
  count: number;
  unapproved: number;
  uncategorized: number;
  transactions: Transaction[];
}

export interface AuthStatus {
  allowed?: boolean;
  exists?: boolean;
  email?: string | null;
  mustSetPassword?: boolean;
  mfaEnabled?: boolean;
  ok?: boolean;
  error?: string | null;
}

export interface AuthLogin {
  ok?: boolean;
  next?: string | null;
  email?: string | null;
  mfaToken?: string | null;
  token?: string | null;
  expiresAt?: number | null;
  error?: string | null;
  mustSetPassword?: boolean;
}

export interface MfaSetup {
  secret?: string | null;
  otpauth?: string | null;
  error?: string | null;
}

export interface PushReport {
  pushed?: number;
  failed?: number;
  [key: string]: unknown;
}

export interface CategorizeResult {
  marked?: unknown;
  push?: PushReport | null;
  error?: string;
}
