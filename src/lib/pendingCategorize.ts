/**
 * Delayed categorize commit (default 10s) with undo.
 * Local cache is patched immediately so the list drops rows; the API
 * push waits so the user can undo before anything hits the cloud.
 */

import { ledgerApi } from '../api/client';
import type { Transaction } from '../api/types';
import {
  patchTransactionCategory,
  patchTransactionCategoryMany,
  restoreTransactionSnapshots,
} from './dataStore';

export const CATEGORIZE_UNDO_DELAY_MS = 10_000;

export interface PendingCategorize {
  id: string;
  /** Transactions affected by this categorize action. */
  ynabIds: string[];
  categoryId: string;
  categoryName: string;
  /** Pre-categorize snapshots for undo. */
  snapshots: Transaction[];
  /** Short UI label, e.g. "Coffee" or "3 txns → Dining". */
  label: string;
  expiresAt: number;
}

type Listener = () => void;
type ErrorListener = (message: string) => void;
type SuccessListener = (message: string) => void;

const pending = new Map<string, PendingCategorize & { timer: ReturnType<typeof setTimeout> }>();
const listeners = new Set<Listener>();
const errorListeners = new Set<ErrorListener>();
const successListeners = new Set<SuccessListener>();
let pageHideHooked = false;

function notify() {
  listeners.forEach((fn) => fn());
}

function notifyError(message: string) {
  errorListeners.forEach((fn) => fn(message));
}

function notifySuccess(message: string) {
  successListeners.forEach((fn) => fn(message));
}

export function subscribePendingCategorize(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function subscribePendingCategorizeErrors(fn: ErrorListener): () => void {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
}

export function subscribePendingCategorizeSuccess(
  fn: SuccessListener,
): () => void {
  successListeners.add(fn);
  return () => successListeners.delete(fn);
}

/** Ensure pending categorizes flush if the tab closes during the undo window. */
function ensurePageHideFlush() {
  if (pageHideHooked || typeof window === 'undefined') return;
  pageHideHooked = true;
  window.addEventListener('pagehide', () => {
    void flushAllPendingCategorize();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushAllPendingCategorize();
    }
  });
}

export function getPendingCategorizes(): PendingCategorize[] {
  return [...pending.values()]
    .map(({ timer: _t, ...rest }) => rest)
    .sort((a, b) => b.expiresAt - a.expiresAt);
}

export function getPendingCategorizeCount(): number {
  return pending.size;
}

function makeId(): string {
  return `pc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildLabel(
  snapshots: Transaction[],
  categoryName: string,
  payeeHint?: string,
): string {
  if (snapshots.length === 1) {
    const name = payeeHint?.trim() || 'Transaction';
    return `${name} → ${categoryName}`;
  }
  return `${snapshots.length} txns → ${categoryName}`;
}

/**
 * Optimistically categorize locally, schedule API after [delayMs].
 * Returns the pending entry id (for tests / focus).
 */
export function enqueueCategorize(opts: {
  snapshots: Transaction[];
  categoryId: string;
  categoryName: string;
  payeeHint?: string;
  delayMs?: number;
}): string | null {
  const targets = opts.snapshots.filter((t) => !t.transferAccountId);
  if (targets.length === 0) return null;

  const delayMs = opts.delayMs ?? CATEGORIZE_UNDO_DELAY_MS;
  const ynabIds = targets.map((t) => t.ynabId);
  const snapshots = targets.map((t) => ({ ...t }));

  // Local remove first — UI returns to the list instantly.
  if (ynabIds.length === 1) {
    patchTransactionCategory(ynabIds[0], opts.categoryId);
  } else {
    patchTransactionCategoryMany(ynabIds, opts.categoryId);
  }

  ensurePageHideFlush();

  const id = makeId();
  const entry: PendingCategorize & { timer: ReturnType<typeof setTimeout> } = {
    id,
    ynabIds,
    categoryId: opts.categoryId,
    categoryName: opts.categoryName,
    snapshots,
    label: buildLabel(snapshots, opts.categoryName, opts.payeeHint),
    expiresAt: Date.now() + delayMs,
    timer: setTimeout(() => {
      void commitPending(id);
    }, delayMs),
  };
  pending.set(id, entry);
  notify();
  return id;
}

/** Commit every pending categorize immediately (tab hide / page leave). */
export async function flushAllPendingCategorize(): Promise<void> {
  const ids = [...pending.keys()];
  for (const id of ids) {
    const entry = pending.get(id);
    if (!entry) continue;
    clearTimeout(entry.timer);
    await commitPending(id);
  }
}

function pushErrorMessage(push: {
  failed?: number;
  error?: string;
  results?: Array<{ ok?: boolean; error?: string; ynabTxnId?: string }>;
} | null | undefined): string | null {
  if (!push) return null;
  if (typeof push.error === 'string' && push.error.trim()) return push.error;
  if ((push.failed ?? 0) <= 0) return null;
  const firstFail = (push.results || []).find((r) => r && r.ok === false);
  if (firstFail?.error) return firstFail.error;
  return `YNAB push failed (${push.failed})`;
}

async function commitPending(id: string): Promise<void> {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  notify();

  try {
    let pushed = 0;
    for (const t of entry.snapshots) {
      // Writes category to DynamoDB (R2Finance), marks PENDING_PUSH, then
      // immediately pushes that row to the YNAB API.
      const result = await ledgerApi.categorize(
        t.ynabId,
        entry.categoryId,
        true,
      );
      const pushErr = pushErrorMessage(result.push);
      if (result.error) throw new Error(result.error);
      if (pushErr) throw new Error(pushErr);
      pushed += Number(result.push?.pushed) || 0;
    }
    const n = entry.ynabIds.length;
    notifySuccess(
      pushed > 0
        ? `Saved + pushed to YNAB · ${entry.label}`
        : `Saved in R2Finance · ${entry.label}${n > 1 ? ` (${n})` : ''} — YNAB may catch up on next tick`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[categorize] delayed save failed', msg);
    // Revert local cache so the list is truthful.
    restoreTransactionSnapshots(entry.snapshots);
    notifyError(
      `Category save failed: ${msg}. Rows restored — try again.`,
    );
  }
}

/** Undo one pending categorize by id. Restores local snapshots; no API call. */
export function undoCategorize(id: string): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(id);
  restoreTransactionSnapshots(entry.snapshots);
  notify();
  return true;
}

/** Undo the most recent pending categorize. */
export function undoLatestCategorize(): boolean {
  const list = getPendingCategorizes();
  if (list.length === 0) return false;
  return undoCategorize(list[0].id);
}

/** Seconds remaining until commit (ceil). */
export function pendingSecondsLeft(entry: PendingCategorize, now = Date.now()): number {
  return Math.max(0, Math.ceil((entry.expiresAt - now) / 1000));
}
