/** Fallback palette (same as R2FinanceAPI) when a category has no DDB color yet. */
export const CATEGORY_PALETTE = [
  '#6366F1',
  '#22C55E',
  '#EAB308',
  '#EF4444',
  '#8B5CF6',
  '#A5B4FC',
  '#06B6D4',
  '#F97316',
  '#EC4899',
  '#14B8A6',
  '#3B82F6',
  '#84CC16',
  '#F43F5E',
  '#0EA5E9',
  '#A855F7',
  '#65A30D',
] as const;

export const UNCATEGORIZED_COLOR = '#6366F1';
export const ALL_OTHERS_COLOR = '#A5B4FC';
export const INCOME_COLOR = '#22C55E';
export const SPENDING_COLOR = '#3B82F6';

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function isHexColor(v: string | null | undefined): v is string {
  return typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v);
}

/** Prefer DDB color; otherwise stable hash of category id (mirrors API). */
export function colorForCategoryId(
  id: string | null | undefined,
  colorById: Map<string, string>,
  name?: string | null,
): string {
  if (!id || id === '__uncat') return UNCATEGORIZED_COLOR;
  const existing = colorById.get(id);
  if (isHexColor(existing)) return existing;
  if (name && /uncategor/i.test(name)) return UNCATEGORIZED_COLOR;
  return CATEGORY_PALETTE[hashId(id) % CATEGORY_PALETTE.length];
}

export type StackSegment = {
  id: string;
  name: string;
  amount: number;
  share: number;
  color: string;
};

/** Top N categories + All Others for stacked bar + list. */
export function buildStackSegments(
  rows: { id: string; name: string; amount: number; share: number }[],
  colorById: Map<string, string>,
  topN = 5,
): { segments: StackSegment[]; totalAbs: number } {
  const spending = rows.filter((r) => r.amount < 0);
  const totalAbs = spending.reduce((s, r) => s + Math.abs(r.amount), 0);
  if (totalAbs <= 0) return { segments: [], totalAbs: 0 };

  const top = spending.slice(0, topN);
  const rest = spending.slice(topN);
  const segments: StackSegment[] = top.map((r) => ({
    id: r.id,
    name: r.name,
    amount: r.amount,
    share: Math.abs(r.amount) / totalAbs,
    color: colorForCategoryId(r.id, colorById, r.name),
  }));
  if (rest.length > 0) {
    const restAbs = rest.reduce((s, r) => s + Math.abs(r.amount), 0);
    segments.push({
      id: '__others',
      name: 'All Others',
      amount: -restAbs,
      share: restAbs / totalAbs,
      color: ALL_OTHERS_COLOR,
    });
  }
  return { segments, totalAbs };
}
