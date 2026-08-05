/** YNAB-style milliunits: 1000 = $1.00 */
export function formatMoney(
  milli: number,
  currency = 'USD',
  opts: { sign?: boolean } = {},
): string {
  const dollars = milli / 1000;
  const abs = Math.abs(dollars).toLocaleString(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (opts.sign) {
    if (milli > 0) return `+${abs}`;
    if (milli < 0) return `−${abs}`;
    return abs;
  }
  if (milli < 0) return `−${abs}`;
  return abs;
}

export function moneyClass(milli: number): string {
  if (milli > 0) return 'amt-pos';
  if (milli < 0) return 'amt-neg';
  return 'amt-zero';
}

export function parseMoneyInput(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '+') return null;
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 1000);
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function formatMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}
