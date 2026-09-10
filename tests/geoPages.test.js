const test = require('node:test');
const assert = require('node:assert/strict');
const geoPages = require('../lib/geoPages');
const { countInstitutions } = require('../lib/query');
const db = require('../db');

test('geoPages: powiaty i przecięcia województwo x typ nie są puste', () => {
  assert.ok(geoPages.counties().length > 20);
  assert.ok(geoPages.voivodeshipTypes().length > 20);
});

test('geoPages: każdy wpis ma co najmniej MIN_RECORDS instytucji', () => {
  for (const c of geoPages.counties()) {
    const n = countInstitutions(db, { filters: { voivodeship: c.voivodeship.value, county: c.countyValue } });
    assert.ok(n >= geoPages.MIN_RECORDS, `${c.path} ma ${n} < ${geoPages.MIN_RECORDS}`);
    assert.equal(n, c.count);
  }
  for (const x of geoPages.voivodeshipTypes()) {
    const n = countInstitutions(db, { filters: { voivodeship: x.voivodeship.value, type: x.type.slug } });
    assert.ok(n >= geoPages.MIN_RECORDS, `${x.path} ma ${n} < ${geoPages.MIN_RECORDS}`);
  }
});

test('geoPages: lookup po slugu odwzorowuje wpis z listy', () => {
  const c = geoPages.counties()[0];
  assert.equal(geoPages.countyBySlug(c.voivodeship.slug, c.countySlug), c);
  assert.equal(geoPages.countyBySlug('nieistnieje', 'nieistnieje'), null);

  const x = geoPages.voivodeshipTypes()[0];
  assert.equal(geoPages.voivodeshipTypeBySlug(x.voivodeship.slug, x.type.slug), x);
  assert.equal(geoPages.voivodeshipTypeBySlug('slaskie', 'nieistnieje'), null);
});

test('geoPages: slug powiatu jest unikalny w obrębie województwa', () => {
  const seen = new Set();
  for (const c of geoPages.counties()) {
    const key = `${c.voivodeship.slug}/${c.countySlug}`;
    assert.ok(!seen.has(key), `kolizja slugu: ${key}`);
    seen.add(key);
  }
});

test('geoPages: powiaty grodzkie (M. ...) są wykluczone', () => {
  for (const c of geoPages.counties()) {
    assert.doesNotMatch(c.countyValue, /^M[.\s]/);
  }
});
