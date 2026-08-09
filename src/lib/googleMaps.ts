/**
 * Google Maps deep links for categorize / approval context.
 * Only when a place was resolved as text (locationDisplay / address / city).
 * Never use raw lat/lon pins — search by payee + place name.
 */

import type { Transaction, TransactionLocation } from '../api/types';

/**
 * True when a string is only a lat/lon pair (e.g. "47.6,-122.3").
 * Those are coordinates, not a found place label.
 */
export function isCoordinateQuery(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return /^-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?$/.test(t);
}

/** Non-empty place text that is not a bare coordinate pair. */
export function isPlaceLabel(s?: string | null): boolean {
  const t = s?.trim();
  if (!t) return false;
  if (isCoordinateQuery(t)) return false;
  return true;
}

/**
 * True when we have a human place label (not merely coordinates).
 */
export function hasFoundPlace(
  locationDisplay?: string | null,
  location?: TransactionLocation | null,
): boolean {
  if (isPlaceLabel(locationDisplay)) return true;
  if (isPlaceLabel(location?.text)) return true;
  if (isPlaceLabel(location?.address)) return true;
  if (isPlaceLabel(location?.city)) return true;
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
  const textRaw =
    loc?.text?.trim() ||
    [loc?.address, loc?.city, loc?.region, loc?.postal_code, loc?.country]
      .map((s) => (s != null ? String(s).trim() : ''))
      .filter(Boolean)
      .join(', ');
  // Drop coord-only fragments; never pin by lat/lon.
  const text = isPlaceLabel(textRaw) ? textRaw : '';
  const display = isPlaceLabel(opts.locationDisplay) ? opts.locationDisplay!.trim() : '';

  const parts: string[] = [];
  if (payee) parts.push(payee);
  if (text && text.toLowerCase() !== payee.toLowerCase()) parts.push(text);
  else if (display && display.toLowerCase() !== payee.toLowerCase()) {
    parts.push(display);
  }

  const query = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (!query || isCoordinateQuery(query)) return null;
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
