/**
 * Node 22+ --experimental-strip-types unit tests for maps link policy.
 * Run: npm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasFoundPlace,
  isCoordinateQuery,
  isPlaceLabel,
  isStreetAddress,
  placeNameRelated,
  googleMapsUrl,
  mapsLinkForTxn,
} from './googleMaps.ts';

function queryOf(url: string | null): string {
  if (!url) return '';
  const q = url.split('query=')[1] || '';
  return decodeURIComponent(q);
}

describe('isCoordinateQuery', () => {
  it('detects bare lat/lon pairs', () => {
    assert.equal(isCoordinateQuery('47.6,-122.3'), true);
    assert.equal(isCoordinateQuery('47.6062, -122.3321'), true);
    assert.equal(isCoordinateQuery('-33.8688,151.2093'), true);
  });
  it('rejects place labels', () => {
    assert.equal(isCoordinateQuery('Seattle, WA'), false);
    assert.equal(isCoordinateQuery('123 Main St'), false);
    assert.equal(isCoordinateQuery(''), false);
  });
});

describe('hasFoundPlace', () => {
  it('true for locationDisplay city', () => {
    assert.equal(hasFoundPlace('Seattle, WA', null), true);
  });
  it('false for coords-only locationDisplay', () => {
    assert.equal(hasFoundPlace('47.6,-122.3', null), false);
  });
  it('false for lat/lon only location object', () => {
    assert.equal(
      hasFoundPlace(null, { lat: 47.6, lon: -122.3 }),
      false,
    );
  });
  it('true for city on location object', () => {
    assert.equal(
      hasFoundPlace(null, { city: 'Seattle', region: 'WA', lat: 47.6, lon: -122.3 }),
      true,
    );
  });
  it('false when empty', () => {
    assert.equal(hasFoundPlace(null, null), false);
    assert.equal(hasFoundPlace('  ', {}), false);
  });
});

describe('isStreetAddress / placeNameRelated', () => {
  it('street when digits present', () => {
    assert.equal(isStreetAddress('1023 4th Ave'), true);
    assert.equal(isStreetAddress("Sister's cafe"), false);
    assert.equal(isStreetAddress('47.6,-122.3'), false);
  });
  it('rejects mismatched POI names', () => {
    assert.equal(placeNameRelated("Don's Cafe", "Sister's cafe"), false);
    assert.equal(placeNameRelated("Don's Cafe", "Don's Cafe"), true);
    assert.equal(placeNameRelated('Voyager Cafe', 'Voyager Coffee House'), true);
  });
});

describe('googleMapsUrl / mapsLinkForTxn', () => {
  it('null without place', () => {
    assert.equal(googleMapsUrl({ payee: 'Cafe' }), null);
    assert.equal(
      mapsLinkForTxn({ locationDisplay: null, location: null }, 'Cafe'),
      null,
    );
  });
  it('null for coords-only even with payee', () => {
    assert.equal(
      googleMapsUrl({
        payee: 'Cafe',
        locationDisplay: '47.6,-122.3',
        location: { lat: 47.6, lon: -122.3 },
      }),
      null,
    );
  });
  it('search URL uses place text not lat/lon pin', () => {
    const url = googleMapsUrl({
      payee: 'Voyager Cafe',
      locationDisplay: 'Seattle, WA',
      location: { city: 'Seattle', region: 'WA', lat: 47.6, lon: -122.3 },
    });
    assert.ok(url);
    assert.match(url!, /maps\/search\/\?api=1&query=/);
    const q = queryOf(url);
    assert.match(q, /Voyager/);
    assert.match(q, /Seattle/);
    assert.equal(isCoordinateQuery(q), false);
    assert.doesNotMatch(url!, /query=47\.6,-122\.3/);
  });
  it('drops mismatched geocoded POI name (Don\'s → Sister\'s)', () => {
    const url = googleMapsUrl({
      payee: "Don's Cafe",
      locationDisplay: 'Bellevue, WA',
      location: {
        address: "Sister's cafe",
        city: 'Bellevue',
        region: 'WA',
        postal_code: '98005',
        country: 'US',
        text: "Sister's cafe, Bellevue, WA, 98005, US",
      },
    });
    assert.ok(url);
    const q = queryOf(url);
    assert.match(q, /Don/);
    assert.match(q, /Bellevue/);
    assert.doesNotMatch(q, /Sister/i);
    // Must not be the old garbage concat
    assert.doesNotMatch(q, /Don's Cafe Sister/i);
  });
  it('keeps real street address with payee + city', () => {
    const url = googleMapsUrl({
      payee: "Don's Cafe",
      locationDisplay: 'Bellevue, WA',
      location: {
        address: '1023 4th Ave',
        city: 'Bellevue',
        region: 'WA',
        postal_code: '98005',
        country: 'US',
      },
    });
    assert.ok(url);
    const q = queryOf(url);
    assert.match(q, /1023/);
    assert.match(q, /Bellevue/);
    assert.match(q, /Don/);
  });
  it('null for restaurant payee without place', () => {
    assert.equal(
      mapsLinkForTxn(
        {
          locationDisplay: null,
          location: null,
          plaidMerchantName: "Don's Cafe",
        },
        "Don's Cafe",
      ),
      null,
    );
  });
  it('isPlaceLabel rejects blank and coords', () => {
    assert.equal(isPlaceLabel(null), false);
    assert.equal(isPlaceLabel('  '), false);
    assert.equal(isPlaceLabel('47.0, -122.0'), false);
    assert.equal(isPlaceLabel('Portland, OR'), true);
  });
});
