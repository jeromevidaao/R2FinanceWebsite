/**
 * Google Maps deep links for categorize / approval context.
 * Prefer lat/lon pin when Plaid location has coordinates; else search by
 * payee + city so restaurant places open with useful results.
 */

import type { Transaction, TransactionLocation } from '../api/types';

const RESTAURANT_PFC_RE =
  /FOOD|RESTAURANT|COFFEE|CAFE|BAR|DINING|FAST.?FOOD|TAKEOUT|BAKERY|BREWERY|PUB|NIGHTLIFE/i;

/** True when Plaid personal finance category looks like food/restaurant. */
export function isRestaurantPlace(plaidPfc?: string | null): boolean {
  if (!plaidPfc) return false;
  return RESTAURANT_PFC_RE.test(plaidPfc);
}

/**
 * Build a Google Maps URL for a merchant place, or null when nothing useful
 * to search (no coords, no payee, no location label).
 */
export function googleMapsUrl(opts: {
  payee?: string | null;
  locationDisplay?: string | null;
  location?: TransactionLocation | null;
}): string | null {
  const loc = opts.location;
  const lat = loc?.lat;
  const lon = loc?.lon;
  if (
    lat != null &&
    lon != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lon)
  ) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  }

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
 * When to surface a Maps link during categorization:
 * - any row with a place pin (locationDisplay / coords / address), or
 * - restaurant-like PFC with a resolvable payee name.
 */
export function mapsLinkForTxn(
  txn: Pick<
    Transaction,
    'location' | 'locationDisplay' | 'plaidPfc' | 'plaidMerchantName'
  >,
  payee?: string | null,
): string | null {
  const hasPlace =
    !!txn.locationDisplay?.trim() ||
    (txn.location?.lat != null && txn.location?.lon != null) ||
    !!txn.location?.text?.trim() ||
    !!txn.location?.address?.trim() ||
    !!txn.location?.city?.trim();

  const name =
    payee?.trim() ||
    txn.plaidMerchantName?.trim() ||
    null;

  if (!hasPlace && !(isRestaurantPlace(txn.plaidPfc) && name)) {
    return null;
  }

  return googleMapsUrl({
    payee: name,
    locationDisplay: txn.locationDisplay,
    location: txn.location,
  });
}
