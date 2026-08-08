/**
 * User-friendly transaction times for Spending / categorization.
 *
 * - Instant/timestamp: "1h ago", "30m ago", then calendar rules
 * - Date-only (YYYY-MM-DD): Today / Yesterday / N days ago / Last Saturday / then absolute date
 * - After 7 calendar days: "Aug 1" or "Aug 1, 2025" if not this year
 */

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseLocalDateOnly(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(y, mo, day);
  if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
  return d;
}

function formatAbsolute(day: Date, today: Date): string {
  const sameYear = day.getFullYear() === today.getFullYear();
  return day.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/**
 * Calendar-day relative labels (ledger dates without time-of-day).
 */
export function formatCalendarDay(
  day: Date,
  today: Date = new Date(),
  locale?: string,
): string {
  const a = startOfLocalDay(day);
  const b = startOfLocalDay(today);
  const days = Math.round((b.getTime() - a.getTime()) / 86_400_000);

  if (days < 0) return formatAbsolute(day, today);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days === 2) return '2 days ago';
  if (days >= 3 && days <= 6) {
    const weekday = day.toLocaleDateString(locale, { weekday: 'long' });
    return `Last ${weekday}`;
  }
  return formatAbsolute(day, today);
}

/**
 * @param raw ISO date `YYYY-MM-DD`, or full ISO-8601 timestamp
 * @param now injectable for tests
 */
export function formatFriendlyDate(
  raw: string | null | undefined,
  now: Date = new Date(),
): string {
  if (raw == null || !String(raw).trim()) return '';
  const trimmed = String(raw).trim();

  // Pure date-only → calendar path (never "Nh ago" at midnight)
  const dateOnly = parseLocalDateOnly(trimmed);
  if (dateOnly) {
    return formatCalendarDay(dateOnly, now);
  }

  // Timestamp with time component
  if (trimmed.includes('T') || /[Zz]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const then = new Date(trimmed);
    if (!Number.isNaN(then.getTime())) {
      const sec = Math.floor((now.getTime() - then.getTime()) / 1000);
      if (sec >= 0 && sec < 24 * 3600) {
        const hours = Math.floor(sec / 3600);
        const mins = Math.floor(sec / 60);
        if (sec < 60) return 'just now';
        if (mins < 60) return mins === 1 ? '1m ago' : `${mins}m ago`;
        if (hours < 24) return hours === 1 ? '1h ago' : `${hours}h ago`;
      }
      return formatCalendarDay(then, now);
    }
  }

  // Fallback: try first 10 chars as date
  const fallback = parseLocalDateOnly(trimmed.slice(0, 10));
  if (fallback) return formatCalendarDay(fallback, now);
  return trimmed;
}
