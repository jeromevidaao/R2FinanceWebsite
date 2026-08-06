import type { CategoryChip as Chip } from '../lib/categoryDisplay';

export function CategoryChip({ chip }: { chip: Chip }) {
  return (
    <span className={`cat-chip cat-chip--${chip.kind}`} title={chip.label}>
      <span className="cat-chip-icon" aria-hidden>
        {chip.icon}
      </span>
      <span className="cat-chip-label">{chip.label}</span>
    </span>
  );
}
