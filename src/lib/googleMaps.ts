/**
 * Google Maps deep links for categorize / approval context.
 * Only when a place was resolved as text (locationDisplay / address / city).
 * Never use raw lat/lon pins — search by payee + place name.
 */

import type { Transaction, TransactionLocation } from '../api/types';

/**
 * True when we have a human place label (not merely coordinates).
 */
export function hasFoundPlace(
  locationDisplay?: string | null,
  location?: TransactionLocation | null,
): boolean {
  if (locationDisplay?.trim()) return true;
  if (location?.text?.trim()) return true;
  if (location?.address?.trim()) return true;
  if (location?.city?.trim()) return true;
  return false;
}

/**
 * Build a Google Maps search URL from place text, or null when no place
 * label is available (coordinates alone are not enough).
 */
export function googleMapsUrl(opts: {
  payee?: string | null;
  locationDisplay?: string | null;
  location?: TransactionLocation | null;
}): string | null {
  if (!hasFoundPlace(opts.locationDisplay, opts.location)) return null;

  const loc = opts.location;
  const payee = opts.payee?.trim() || '';
  const text =
    loc?.text?.trim() ||
    [loc?.address, loc?.city, loc?.region, loc?.postal_code, loc?.country]
      .map((s) => (s != null ? String(s).trim() : ''))
      .filter(Boolean)
      .join(', ');
  const display = opts.locationDisplay?.trim() || '';

  const parts: string[] = [];
  if (payee) parts.push(payee);
  if (text && text.toLowerCase() !== payee.toLowerCase()) parts.push(text);
  else if (display && display.toLowerCase() !== payee.toLowerCase()) {
    parts.push(display);
  }

  const query = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Surface a Maps link only when enrich found a place label
 * (locationDisplay / address / city). Coords-only and restaurant-name
 * guesses without a place are suppressed.
 */
export function mapsLinkForTxn(
  txn: Pick<
    Transaction,
    'location' | 'locationDisplay' | 'plaidMerchantName'
  >,
  payee?: string | null,
): string | null {
  if (!hasFoundPlace(txn.locationDisplay, txn.location)) return null;

  const name =
    payee?.trim() ||
    txn.plaidMerchantName?.trim() ||
    null;

  return googleMapsUrl({
    payee: name,
    locationDisplay: txn.locationDisplay,
    location: txn.location,
  });
}
