import type {
  Account,
  AuthLogin,
  AuthStatus,
  CategorizeResult,
  Category,
  CategoryGroup,
  InboxResponse,
  MfaSetup,
  Payee,
  Plan,
  Stats,
  SyncChanges,
  Transaction,
} from './types';

export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ||
  'https://x0wiir7m27.execute-api.us-east-1.amazonaws.com';

const TOKEN_KEY = 'r2finance_session_token';
const EMAIL_KEY = 'r2finance_session_email';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getEmail(): string | null {
  return localStorage.getItem(EMAIL_KEY);
}

export function setSession(token: string, email: string) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EMAIL_KEY, email);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMAIL_KEY);
  // Drop local ledger so the next login does a clean full hydrate.
  void import('../lib/ledgerPersist').then((m) => m.clearPersisted());
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!headers.has('content-type') && init.body) {
    headers.set('content-type', 'application/json');
  }
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (!res.ok) {
    const err = (data as { error?: string })?.error || res.statusText;
    throw new Error(err || `HTTP ${res.status}`);
  }
  return data as T;
}

function get<T>(path: string) {
  return request<T>(path, { method: 'GET' });
}

function post<T>(path: string, body?: unknown) {
  return request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function patch<T>(path: string, body?: unknown) {
  return request<T>(path, {
    method: 'PATCH',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// ── Auth ──────────────────────────────────────────────────────────────
export const authApi = {
  bootstrap: () => post<AuthStatus>('/v1/auth/bootstrap', {}),
  status: (email: string) => post<AuthStatus>('/v1/auth/status', { email }),
  setPassword: (email: string, password: string) =>
    post<AuthLogin>('/v1/auth/set-password', { email, password }),
  login: (email: string, password: string) =>
    post<AuthLogin>('/v1/auth/login', { email, password, client: 'web' }),
  mfaSetup: (email: string, password: string) =>
    post<MfaSetup>('/v1/auth/mfa/setup', { email, password }),
  mfaEnable: (email: string, password: string, code: string) =>
    post<AuthLogin>('/v1/auth/mfa/enable', {
      email,
      password,
      code,
      client: 'web',
    }),
  mfaVerify: (mfaToken: string, code: string) =>
    post<AuthLogin>('/v1/auth/mfa/verify', {
      mfaToken,
      code,
      client: 'web',
    }),
  me: () => get<{ email: string; expiresAt: number }>('/v1/auth/me'),
  forgotPassword: (email: string) =>
    post<{ ok?: boolean; message?: string; error?: string; website?: string }>(
      '/v1/auth/forgot-password',
      { email },
    ),
  resetPassword: (token: string, password: string) =>
    post<{ ok?: boolean; message?: string; error?: string; email?: string }>(
      '/v1/auth/reset-password',
      { token, password },
    ),
};

// ── Ledger ────────────────────────────────────────────────────────────
export const ledgerApi = {
  health: () => get<{ ok: boolean; service: string }>('/health'),
  stats: () => get<Stats>('/v1/stats'),
  plan: () => get<{ plan: Plan }>('/v1/plan').then((r) => r.plan),
  accounts: () =>
    get<{ accounts: Account[] }>('/v1/accounts').then((r) => r.accounts),
  /**
   * Set or clear a user nickname for a ledger account (not pushed to YNAB).
   * Pass null / empty string to clear (next sync re-seeds from YNAB name).
   */
  setAccountAlias: (ynabId: string, alias: string | null) =>
    patch<{ ok: boolean; account: Account }>(
      `/v1/accounts/${encodeURIComponent(ynabId)}`,
      { alias },
    ),
  /**
   * Pre-fill empty aliases from YNAB account names (pull + seed).
   * Skips accounts where the user already saved a custom nickname.
   */
  seedAccountAliases: () =>
    post<{ ok: boolean; seeded: number; skipped: number; total: number }>(
      '/v1/accounts/seed-aliases',
      {},
    ),
  categories: () =>
    get<{ groups: CategoryGroup[]; categories: Category[] }>('/v1/categories'),
  /**
   * Create category in YNAB + R2Finance DDB (immediate dual-write).
   */
  createCategory: (name: string, categoryGroupId: string) =>
    post<{
      ok: boolean;
      ynab: boolean;
      category: Category;
      error?: string;
    }>('/v1/categories', { name, categoryGroupId }),
  /**
   * Rename and/or move category group — YNAB + DDB.
   */
  updateCategory: (
    ynabId: string,
    body: { name?: string; categoryGroupId?: string },
  ) =>
    patch<{
      ok: boolean;
      ynab: boolean;
      category: Category;
      error?: string;
    }>(`/v1/categories/${encodeURIComponent(ynabId)}`, body),
  /**
   * Soft-delete in DDB; attempts YNAB DELETE (often unsupported by YNAB API).
   */
  deleteCategory: (ynabId: string) =>
    request<{
      ok: boolean;
      ynabId: string;
      ynab: boolean;
      ynabError?: string | null;
      warning?: string | null;
      error?: string;
    }>(`/v1/categories/${encodeURIComponent(ynabId)}`, { method: 'DELETE' }),
  payees: () => get<{ payees: Payee[] }>('/v1/payees').then((r) => r.payees),
  /** Authoritative needs-attention list (unapproved + uncategorized). */
  inbox: () => get<InboxResponse>('/v1/inbox'),
  transactions: () =>
    get<{ transactions: Transaction[] }>('/v1/transactions').then(
      (r) => r.transactions,
    ),
  /**
   * Local-first snapshot: full when since=0 / full=1, else rows changed after cursor.
   * Includes deleted tombstones in delta mode.
   * Transactions may be paged (`txnOffset` / `hasMore`) — use syncChangesAll for a full merge.
   */
  syncChanges: (since = 0, full = false, txnOffset = 0) => {
    const params = new URLSearchParams();
    if (full || since <= 0) params.set('full', '1');
    else params.set('since', String(since));
    if (txnOffset > 0) params.set('txnOffset', String(txnOffset));
    return get<SyncChanges>(`/v1/sync/changes?${params.toString()}`);
  },
  /**
   * Fetch all pages of /v1/sync/changes and merge into one pack.
   * Required for full snapshots (~7k+ txns) which exceed the Lambda 6MB limit in one shot.
   */
  syncChangesAll: async (since = 0, full = false): Promise<SyncChanges> => {
    let txnOffset = 0;
    let first: SyncChanges | null = null;
    const transactions: SyncChanges['transactions'] = [];
    // Safety cap: 40 pages × 2500 = 100k rows (way above current ledger).
    for (let page = 0; page < 40; page++) {
      const pack = await ledgerApi.syncChanges(since, full, txnOffset);
      if (!first) first = pack;
      transactions.push(...(pack.transactions || []));
      if (!pack.hasMore) {
        return {
          ...first,
          ...pack,
          // Meta lives on page 0; keep first-page entities.
          plan: first.plan || pack.plan,
          accounts: first.accounts?.length ? first.accounts : pack.accounts || [],
          groups: first.groups?.length ? first.groups : pack.groups || [],
          categories: first.categories?.length
            ? first.categories
            : pack.categories || [],
          payees: first.payees?.length ? first.payees : pack.payees || [],
          transactions,
          hasMore: false,
          txnOffset: 0,
          nextTxnOffset: transactions.length,
          txnTotal: pack.txnTotal ?? transactions.length,
          cursor: pack.cursor || pack.serverTime,
          counts: {
            accounts: first.counts?.accounts ?? first.accounts?.length ?? 0,
            groups: first.counts?.groups ?? first.groups?.length ?? 0,
            categories:
              first.counts?.categories ?? first.categories?.length ?? 0,
            payees: first.counts?.payees ?? first.payees?.length ?? 0,
            transactions: transactions.length,
            txnTotal: pack.txnTotal ?? transactions.length,
          },
        };
      }
      txnOffset = pack.nextTxnOffset ?? transactions.length;
    }
    throw new Error('sync/changes pagination exceeded max pages');
  },
  categorize: (ynabTxnId: string, categoryYnabId: string, push = true) =>
    post<CategorizeResult>('/v1/transactions/categorize', {
      ynabTxnId,
      categoryYnabId,
      push,
    }),
  /** Mark one transaction approved (leaves the to-approve list). */
  approve: (ynabTxnId: string, push = true) =>
    post<CategorizeResult>('/v1/transactions/approve', {
      ynabTxnId,
      push,
    }),
  /**
   * Offline-style patch via device push (memo / amount / payee / approved).
   * YNAB push happens on backend tick later.
   */
  devicePush: (body: {
    transactions?: Array<{
      clientId?: string;
      ynabId?: string;
      accountId: string;
      date: string;
      amount: number;
      payeeId?: string | null;
      categoryId?: string | null;
      memo?: string | null;
      cleared?: string;
      approved?: boolean;
      payeeName?: string;
    }>;
  }) => post<{ ok?: boolean; transactions?: unknown[] }>('/v1/device/push', body),
  syncPull: () => post<unknown>('/v1/sync/pull'),
  syncPush: () => post<unknown>('/v1/sync/push'),
  syncTick: () => post<unknown>('/v1/sync/tick'),
  syncImport: (sinceDate = '1990-01-01') =>
    post<unknown>('/v1/sync/import', { sinceDate }),
};

// ── Bank connectors (Plaid — BoA, Chase, …) ───────────────────────────
export type ConnectorId = 'boa' | 'chase' | 'vanguard' | 'venmo';

/** Cached Plaid account row on CONNECTOR meta (no live Plaid for Accounts). */
export type ConnectorAccountPreview = {
  accountId: string;
  name: string;
  officialName?: string | null;
  mask?: string | null;
  type?: string | null;
  subtype?: string | null;
  /** Plaid available balance (preferred for display). */
  available?: number | null;
  current?: number | null;
  limit?: number | null;
  isoCurrencyCode?: string | null;
};

export type ConnectorStatus = {
  connectorId?: ConnectorId | string;
  /** Owner email — each household member has their own bank links. */
  email?: string;
  userKey?: string;
  provider: string;
  institution: string;
  institutionId?: string | null;
  configured: boolean;
  connected: boolean;
  itemId?: string | null;
  connectedAt?: number | null;
  connectedBy?: string | null;
  institutionName?: string;
  accountCount?: number | null;
  accountsPreview?: ConnectorAccountPreview[];
  /** When balances were last written to connector cache. */
  lastBalancesAt?: number | null;
  note?: string;
};

export type HouseholdConnectors = {
  requester: string;
  users: Array<{
    email: string;
    connectors: ConnectorStatus[];
  }>;
};

/** @deprecated use ConnectorStatus */
export type BoaStatus = ConnectorStatus;

export type ConnectorAccount = {
  accountId: string;
  name: string;
  officialName?: string | null;
  mask?: string | null;
  type?: string | null;
  subtype?: string | null;
  balances: {
    available: number | null;
    current: number | null;
    limit: number | null;
    isoCurrencyCode?: string;
  };
};

/** @deprecated use ConnectorAccount */
export type BoaAccount = ConnectorAccount;

export type ConnectorAccounts = {
  ok: boolean;
  connectorId?: string;
  email?: string;
  institutionName?: string;
  itemId?: string | null;
  connected?: boolean;
  accounts: ConnectorAccount[];
  accountsPreview?: ConnectorAccountPreview[];
  lastBalancesAt?: number | null;
  importTransactionsToDdb: boolean;
  source?: string;
};

export type ConnectorRefreshBalances = {
  ok: boolean;
  email?: string;
  refreshedAt?: number;
  results: Array<{
    connectorId: string;
    ok?: boolean;
    skipped?: boolean;
    reason?: string;
    accountCount?: number;
    lastBalancesAt?: number;
    error?: string;
  }>;
};

/** @deprecated use ConnectorAccounts */
export type BoaAccounts = ConnectorAccounts;

export type ConnectorExchangeResult = {
  ok: boolean;
  connected: boolean;
  connectorId?: string;
  itemId: string;
  institutionName: string;
  accounts: ConnectorAccount[];
  importTransactionsToDdb: boolean;
};

export const connectorsApi = {
  /** Connectors for the signed-in email only. */
  list: () =>
    get<{ email?: string; connectors: ConnectorStatus[] }>(
      '/v1/connectors',
    ).then((r) => ({ email: r.email, connectors: r.connectors })),
  /** All household members × banks (status only). */
  household: () =>
    get<HouseholdConnectors>('/v1/connectors?household=1'),
  status: (bank: ConnectorId | string) =>
    get<ConnectorStatus>(`/v1/connectors/${bank}`),
  linkToken: (bank: ConnectorId | string) =>
    post<{
      link_token: string;
      expiration?: string;
      institution?: string;
      connectorId?: string;
      email?: string;
    }>(`/v1/connectors/${bank}/link-token`, {}),
  exchange: (
    bank: ConnectorId | string,
    publicToken: string,
    metadata?: unknown,
  ) =>
    post<ConnectorExchangeResult>(`/v1/connectors/${bank}/exchange`, {
      public_token: publicToken,
      metadata,
    }),
  /**
   * Accounts for a bank. Default = connector DDB cache (no Plaid).
   * Pass live:true to probe Plaid and refresh the cache.
   */
  accounts: (bank: ConnectorId | string, opts?: { live?: boolean }) =>
    get<ConnectorAccounts>(
      `/v1/connectors/${bank}/accounts${opts?.live ? '?live=1' : ''}`,
    ),
  /** Probe every connected bank for this user → update balance cache. */
  refreshBalances: () =>
    post<ConnectorRefreshBalances>('/v1/connectors/refresh-balances', {}),
  disconnect: (bank: ConnectorId | string) =>
    post<{
      ok: boolean;
      connected: boolean;
      connectorId?: string;
      email?: string;
    }>(`/v1/connectors/${bank}/disconnect`),


  // BoA aliases (backward compatible)
  boaStatus: () => get<ConnectorStatus>('/v1/connectors/boa'),
  boaLinkToken: () =>
    post<{ link_token: string; expiration?: string; institution?: string }>(
      '/v1/connectors/boa/link-token',
      {},
    ),
  boaExchange: (publicToken: string, metadata?: unknown) =>
    post<ConnectorExchangeResult>('/v1/connectors/boa/exchange', {
      public_token: publicToken,
      metadata,
    }),
  boaAccounts: () => get<ConnectorAccounts>('/v1/connectors/boa/accounts'),
  boaDisconnect: () =>
    post<{ ok: boolean; connected: boolean }>(
      '/v1/connectors/boa/disconnect',
    ),
};
