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
}

export interface Transaction {
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
  subtransactions: SubTransaction[];
}

export interface Stats {
  itemCount: number;
  byType: Record<string, number>;
  planName?: string;
  ynabPlanId?: string;
  serverKnowledge?: number;
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

export interface CategorizeResult {
  marked?: unknown;
  push?: unknown;
  error?: string;
}
