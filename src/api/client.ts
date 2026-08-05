import type {
  Account,
  AuthLogin,
  AuthStatus,
  CategorizeResult,
  Category,
  CategoryGroup,
  MfaSetup,
  Payee,
  Plan,
  Stats,
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

// ── Auth ──────────────────────────────────────────────────────────────
export const authApi = {
  bootstrap: () => post<AuthStatus>('/v1/auth/bootstrap', {}),
  status: (email: string) => post<AuthStatus>('/v1/auth/status', { email }),
  setPassword: (email: string, password: string) =>
    post<AuthLogin>('/v1/auth/set-password', { email, password }),
  login: (email: string, password: string) =>
    post<AuthLogin>('/v1/auth/login', { email, password }),
  mfaSetup: (email: string, password: string) =>
    post<MfaSetup>('/v1/auth/mfa/setup', { email, password }),
  mfaEnable: (email: string, password: string, code: string) =>
    post<AuthLogin>('/v1/auth/mfa/enable', { email, password, code }),
  mfaVerify: (mfaToken: string, code: string) =>
    post<AuthLogin>('/v1/auth/mfa/verify', { mfaToken, code }),
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
  categories: () =>
    get<{ groups: CategoryGroup[]; categories: Category[] }>('/v1/categories'),
  payees: () => get<{ payees: Payee[] }>('/v1/payees').then((r) => r.payees),
  transactions: () =>
    get<{ transactions: Transaction[] }>('/v1/transactions').then(
      (r) => r.transactions,
    ),
  categorize: (ynabTxnId: string, categoryYnabId: string, push = true) =>
    post<CategorizeResult>('/v1/transactions/categorize', {
      ynabTxnId,
      categoryYnabId,
      push,
    }),
  syncPull: () => post<unknown>('/v1/sync/pull'),
  syncPush: () => post<unknown>('/v1/sync/push'),
  syncTick: () => post<unknown>('/v1/sync/tick'),
  syncImport: (sinceDate = '1990-01-01') =>
    post<unknown>('/v1/sync/import', { sinceDate }),
};

// ── Bank connectors (Plaid / BoA) ─────────────────────────────────────
export type BoaStatus = {
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
  accountsPreview?: Array<{
    accountId: string;
    name: string;
    mask?: string | null;
    type?: string | null;
    subtype?: string | null;
  }>;
  note?: string;
};

export type BoaAccount = {
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

export type BoaAccounts = {
  ok: boolean;
  institutionName?: string;
  itemId?: string | null;
  accounts: BoaAccount[];
  importTransactionsToDdb: boolean;
  source?: string;
};

export const connectorsApi = {
  boaStatus: () => get<BoaStatus>('/v1/connectors/boa'),
  boaLinkToken: () =>
    getOrPostLinkToken(),
  boaExchange: (publicToken: string, metadata?: unknown) =>
    post<{
      ok: boolean;
      connected: boolean;
      itemId: string;
      institutionName: string;
      accounts: BoaAccount[];
      importTransactionsToDdb: boolean;
    }>('/v1/connectors/boa/exchange', {
      public_token: publicToken,
      metadata,
    }),
  boaAccounts: () => get<BoaAccounts>('/v1/connectors/boa/accounts'),
  boaDisconnect: () =>
    post<{ ok: boolean; connected: boolean }>(
      '/v1/connectors/boa/disconnect',
    ),
};

async function getOrPostLinkToken() {
  return post<{
    link_token: string;
    expiration?: string;
    institution?: string;
  }>('/v1/connectors/boa/link-token', {});
}
