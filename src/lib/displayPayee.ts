/**
 * Display payee for ledger rows — bank imports often arrive with empty
 * payeeId but a clear Plaid / import description.
 *
 * Credit-card payments follow reconciliation practice:
 *   "Payment for credit Family Reserve (ending 8053)"
 */

import type { Account, Transaction } from '../api/types';

export function parseImportPayeeName(raw?: string | null): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.startsWith('{')) {
    try {
      const j = JSON.parse(s) as {
        importedPayee?: string;
        import_payee_name?: string;
        payee?: string;
      };
      const name = j.importedPayee || j.import_payee_name || j.payee || null;
      return name && String(name).trim() ? String(name).trim() : null;
    } catch {
      return null;
    }
  }
  return s;
}

export function extractCardEnding(text?: string | null): string | null {
  if (!text) return null;
  const s = String(text);
  const m =
    s.match(/ending\s*(?:in\s*)?#?(\d{4})\b/i) ||
    s.match(/\bcard\s+#?(\d{4})\b/i) ||
    s.match(/\*{2,}(\d{4})\b/);
  return m ? m[1] : null;
}

function isCreditPaymentHint(opts: {
  plaidMerchantName?: string | null;
  plaidPfc?: string | null;
  importPayeeName?: string | null;
}): boolean {
  const pfc = String(opts.plaidPfc || '').toUpperCase();
  if (
    pfc.includes('LOAN_PAYMENT') ||
    pfc.includes('CREDIT_CARD_PAYMENT') ||
    pfc === 'LOAN_PAYMENTS'
  ) {
    return true;
  }
  const blob =
    `${opts.plaidMerchantName || ''} ${opts.importPayeeName || ''}`.toLowerCase();
  return (
    /payment\s+to\s+.*card/.test(blob) ||
    /credit\s*card/.test(blob) ||
    /autopay/.test(blob) ||
    /payment\s+thank\s+you/.test(blob) ||
    /card\s+payment/.test(blob)
  );
}

function findCreditAccountByEnding(
  accounts: Account[],
  ending: string,
): Account | null {
  const ccs = accounts.filter((a) => {
    if (a.closed) return false;
    const t = String(a.type || '').toLowerCase();
    return (
      t.includes('credit') ||
      t === 'creditcard' ||
      t === 'lineofcredit' ||
      t === 'line of credit'
    );
  });
  return ccs.find((a) => a.name.includes(ending)) || null;
}

function accountBaseName(name: string, ending: string): string {
  let n = name.trim();
  n = n.replace(new RegExp(`\\s*${ending}\\s*$`), '').trim();
  return n || name.trim();
}

export function formatCreditPaymentPayee(
  ending: string,
  accounts: Account[],
): string {
  const acct = findCreditAccountByEnding(accounts, ending);
  if (acct) {
    const label = (acct.alias && acct.alias.trim()) || acct.name;
    const base = accountBaseName(label, ending);
    return `Payment for credit ${base} (ending ${ending})`;
  }
  return `Payment for credit card (ending ${ending})`;
}

export function cleanPlaidMerchantName(name?: string | null): string | null {
  if (!name) return null;
  let s = String(name).trim();
  if (!s) return null;
  s = s.replace(/\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*$/, '').trim();
  s = s.replace(/\s+\d{4}-\d{2}-\d{2}\s*$/, '').trim();
  if (s === s.toUpperCase() && /[A-Z]/.test(s) && s.length > 3) {
    s = s
      .toLowerCase()
      .split(/\s+/)
      .map((w) => {
        if (w.length <= 2) return w.toUpperCase();
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(' ');
  }
  return s || null;
}

export type DisplayPayeeInput = {
  payeeName?: string | null;
  transferAccountName?: string | null;
  plaidMerchantName?: string | null;
  plaidName?: string | null;
  plaidDescription?: string | null;
  plaidPfc?: string | null;
  importPayeeName?: string | null;
  accounts?: Account[];
};

/** True when bank/import payee is a generic Venmo ACH label. */
export function isGenericVenmoPayee(text?: string | null): boolean {
  const s = String(text || '').trim();
  if (!s) return false;
  if (/^venmo$/i.test(s)) return true;
  if (/^venmo\b/i.test(s) && /payment|cashout|des:|web id|ppd|orig/i.test(s)) {
    return true;
  }
  return false;
}

function looksLikeVenmoPersonalDesc(s: string): boolean {
  const t = s.trim();
  if (!t || isGenericVenmoPayee(t)) return false;
  if (/^(.+?)\s+["“](.+?)["”]\s*$/.test(t)) return true;
  // Title Case person - note (not ALL-CAPS merchant - CITY)
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+)+\s-\s\S/.test(t)) return true;
  if (/standard\s+transfer/i.test(t)) return true;
  return false;
}

/**
 * Venmo Personal note for UI: "Person - note".
 * Only returns Venmo-style labels (quoted note or stamped "Name - note").
 */
export function venmoDescriptionLabel(opts: {
  plaidDescription?: string | null;
  plaidName?: string | null;
  plaidMerchantName?: string | null;
}): string | null {
  const d = opts.plaidDescription?.trim();
  if (d && looksLikeVenmoPersonalDesc(d)) return d;
  for (const raw of [opts.plaidName, opts.plaidMerchantName]) {
    if (!raw || isGenericVenmoPayee(raw)) continue;
    const s = String(raw).trim();
    const m = s.match(/^(.+?)\s+["“](.+?)["”]\s*$/);
    if (m) return `${m[1].trim()} - ${m[2].trim()}`;
    if (/\s-\s/.test(s) && !/^venmo\b/i.test(s)) return s;
  }
  return null;
}

/** Human payee; null → UI shows "—". */
export function resolveDisplayPayee(input: DisplayPayeeInput): string | null {
  const {
    payeeName,
    transferAccountName,
    plaidMerchantName,
    plaidName,
    plaidDescription,
    plaidPfc,
    importPayeeName: importRaw,
    accounts = [],
  } = input;

  const named =
    payeeName && String(payeeName).trim() ? String(payeeName).trim() : null;
  const venmoLabel = venmoDescriptionLabel({
    plaidDescription,
    plaidName,
    plaidMerchantName,
  });
  if (named && isGenericVenmoPayee(named) && venmoLabel) return venmoLabel;
  if (named) return named;
  if (transferAccountName && String(transferAccountName).trim()) {
    return `Transfer : ${String(transferAccountName).trim()}`;
  }

  const importPayeeName = parseImportPayeeName(importRaw);
  if (isGenericVenmoPayee(importPayeeName) && venmoLabel) return venmoLabel;

  const ending =
    extractCardEnding(plaidMerchantName) || extractCardEnding(importPayeeName);

  if (
    ending &&
    isCreditPaymentHint({ plaidMerchantName, plaidPfc, importPayeeName })
  ) {
    return formatCreditPaymentPayee(ending, accounts);
  }

  if (
    ending &&
    /payment/i.test(`${plaidMerchantName || ''} ${importPayeeName || ''}`)
  ) {
    return formatCreditPaymentPayee(ending, accounts);
  }

  if (venmoLabel) return venmoLabel;
  const plaidClean = cleanPlaidMerchantName(plaidMerchantName);
  if (plaidClean) return plaidClean;
  if (importPayeeName) return importPayeeName;
  return null;
}

/** Append Amazon item titles when the cloud matched an order. */
export function enhanceAmazonDisplayPayee(
  base: string | null | undefined,
  t?: Pick<
    Transaction,
    'amazonItems' | 'amazonItemsSummary' | 'amazonOrderNumber'
  > | null,
): string | null {
  if (!t) return base ?? null;
  const summary =
    (t.amazonItemsSummary && String(t.amazonItemsSummary).trim()) ||
    (Array.isArray(t.amazonItems) && t.amazonItems.length
      ? t.amazonItems
          .map((x) => String(x || '').trim())
          .filter(Boolean)
          .slice(0, 3)
          .join(', ')
      : '');
  if (!summary) return base ?? null;
  const label = (base && String(base).trim()) || 'Amazon';
  if (label.includes(summary)) return label;
  if (/ — /.test(label) && /amazon/i.test(label)) return label;
  return `${label} — ${summary}`;
}

/** Convenience: resolve from a Transaction + account list + optional named payee. */
export function resolveDisplayPayeeForTxn(
  t: Transaction,
  accounts: Account[],
  namedPayee?: string | null,
): string | null {
  const transfer = t.transferAccountId
    ? accounts.find((a) => a.ynabId === t.transferAccountId)
    : null;
  const base = resolveDisplayPayee({
    payeeName: namedPayee ?? t.payeeName ?? null,
    transferAccountName: transfer?.name ?? null,
    plaidMerchantName: t.plaidMerchantName,
    plaidName: t.plaidName,
    plaidDescription: t.plaidDescription,
    plaidPfc: t.plaidPfc,
    importPayeeName: t.importPayeeName,
    accounts,
  });
  return enhanceAmazonDisplayPayee(base, t);
}
