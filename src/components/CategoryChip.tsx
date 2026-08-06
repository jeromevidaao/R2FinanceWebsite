import type { CategoryChip as Chip } from '../lib/categoryDisplay';

/** Airbnb Bélo mark (simple-icons style, monochrome; parent sets color). */
function AirbnbLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M12 0C7.8 0 4.4 3.4 4.4 7.6c0 1.8.6 3.5 1.7 4.9L12 21.5l5.9-9c1.1-1.4 1.7-3.1 1.7-4.9C19.6 3.4 16.2 0 12 0zm0 10.4c-1.5 0-2.8-1.2-2.8-2.8S10.5 4.8 12 4.8s2.8 1.2 2.8 2.8-1.3 2.8-2.8 2.8z"
      />
    </svg>
  );
}

export function CategoryChip({ chip }: { chip: Chip }) {
  return (
    <span className={`cat-chip cat-chip--${chip.kind}`} title={chip.label}>
      {chip.brandIcon === 'airbnb' ? (
        <span className="cat-chip-icon cat-chip-icon--brand" aria-hidden>
          <AirbnbLogo />
        </span>
      ) : (
        <span className="cat-chip-icon" aria-hidden>
          {chip.icon}
        </span>
      )}
      <span className="cat-chip-label">{chip.label}</span>
    </span>
  );
}
