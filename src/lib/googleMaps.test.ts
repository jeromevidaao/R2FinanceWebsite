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
  googleMapsUrl,
  mapsLinkForTxn,
} from './googleMaps.ts';

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
    assert.match(url!, /Voyager/);
    assert.match(url!, /Seattle/);
    assert.equal(isCoordinateQuery(decodeURIComponent(url!.split('query=')[1] || '')), false);
    // Must not be a bare lat,lon pin query
    assert.doesNotMatch(url!, /query=47\.6,-122\.3/);
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
