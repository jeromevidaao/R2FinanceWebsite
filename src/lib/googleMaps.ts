/**
 * Google Maps deep links for categorize / approval context.
 * Only when a place was resolved as text (locationDisplay / address / city).
 * Never use raw lat/lon pins — search by payee + useful place parts.
 *
 * Query quality rules:
 *  - Prefer street address (has a house/street number) + city/region.
 *  - Drop geocoded POI names that do not match the payee (e.g. "Sister's cafe"
 *    for payee "Don's Cafe") — those make Google Maps land on the wrong place.
 *  - Never blindly concatenate payee + location.text.
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

/** Street-like line: contains a digit (house / route number), not a bare POI name. */
export function isStreetAddress(s?: string | null): boolean {
  const t = s?.trim() || '';
  if (!t || isCoordinateQuery(t)) return false;
  return /\d/.test(t);
}

function normTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

/**
 * Soft name relatedness (payee vs geocoded POI label).
 * Used to drop wrong-business pins like "Sister's cafe" for "Don's Cafe".
 */
export function placeNameRelated(a?: string | null, b?: string | null): boolean {
  const na = (a || '').trim().toLowerCase();
  const nb = (b || '').trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const A = normTokens(na);
  const B = normTokens(nb);
  if (!A.size || !B.size) return false;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit += 1;
  const union = new Set([...A, ...B]).size;
  // Require real overlap beyond a generic word alone when names differ a lot.
  // "don cafe" vs "sister cafe" → 1/3 ≈ 0.33 → reject.
  // "voyager cafe" vs "voyager coffee" → 1/3 but "voyager" is distinctive;
  // includes check already fails for coffee/cafe — token "voyager" hits → 1/3.
  // Raise floor slightly and require at least one non-generic token match.
  const generic = new Set([
    'cafe',
    'coffee',
    'restaurant',
    'bar',
    'grill',
    'kitchen',
    'bistro',
    'shop',
    'store',
    'market',
    'food',
    'the',
  ]);
  let distinctive = 0;
  for (const t of A) {
    if (B.has(t) && !generic.has(t)) distinctive += 1;
  }
  if (distinctive >= 1) return true;
  return union ? hit / union >= 0.5 : false;
}

function isUsCountry(c?: string | null): boolean {
  const u = (c || '').trim().toUpperCase();
  return (
    !u ||
    u === 'US' ||
    u === 'USA' ||
    u === 'UNITED STATES' ||
    u === 'UNITED STATES OF AMERICA'
  );
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
  const address = loc?.address?.trim() || '';
  const city = loc?.city?.trim() || '';
  const region = loc?.region?.trim() || '';
  const postal = loc?.postal_code?.trim() || '';
  const country = loc?.country?.trim() || '';
  const display = isPlaceLabel(opts.locationDisplay)
    ? opts.locationDisplay!.trim()
    : '';

  const parts: string[] = [];
  if (payee) parts.push(payee);

  // Street address is high-signal. POI-name "addresses" only if they match payee
  // (or there is no payee). Mismatched POI names are dropped.
  if (address && isStreetAddress(address)) {
    parts.push(address);
  } else if (address && !payee) {
    parts.push(address);
  } else if (address && placeNameRelated(payee, address)) {
    // Same business name already in payee — do not duplicate.
  }
  // else: drop mismatched POI name (Sister's cafe for Don's Cafe)

  const geo: string[] = [];
  if (city) geo.push(city);
  if (region) geo.push(region);
  if (postal) geo.push(postal);
  if (country && !isUsCountry(country)) geo.push(country);

  if (geo.length) {
    const geoStr = geo.join(', ');
    const soFar = parts.join(' ').toLowerCase();
    if (!soFar.includes(geoStr.toLowerCase())) {
      parts.push(geoStr);
    }
  } else if (display) {
    // Fall back to locationDisplay ("City, ST") when structured geo missing.
    const soFar = parts.join(' ').toLowerCase();
    if (
      display.toLowerCase() !== payee.toLowerCase() &&
      !soFar.includes(display.toLowerCase())
    ) {
      parts.push(display);
    }
  }

  const query = parts.join(', ').replace(/\s+/g, ' ').replace(/,\s*,/g, ',').trim();
  if (!query || isCoordinateQuery(query)) return null;
  // Need more than just a bare payee (hasFoundPlace already requires place,
  // but guard if everything was dropped).
  if (payee && query.toLowerCase() === payee.toLowerCase()) return null;
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
