const test = require('node:test');
const assert = require('node:assert/strict');
const geoPages = require('../lib/geoPages');
const { countInstitutions } = require('../lib/query');
const db = require('../db');

test('geoPages: miasta i przecięcia województwo x typ nie są puste', () => {
  assert.ok(geoPages.cities().length >= 1);
  assert.ok(geoPages.voivodeshipTypes().length > 20);
});

test('geoPages: każdy wpis ma co najmniej MIN_RECORDS instytucji', () => {
  for (const c of geoPages.cities()) {
    const n = countInstitutions(db, { filters: { voivodeship: c.voivodeship.value, locality: c.localityValue } });
    assert.ok(n >= geoPages.MIN_RECORDS, `${c.path} ma ${n} < ${geoPages.MIN_RECORDS}`);
    assert.equal(n, c.count);
  }
  for (const x of geoPages.voivodeshipTypes()) {
    const n = countInstitutions(db, { filters: { voivodeship: x.voivodeship.value, type: x.type.slug } });
    assert.ok(n >= geoPages.MIN_RECORDS, `${x.path} ma ${n} < ${geoPages.MIN_RECORDS}`);
  }
});

test('geoPages: lookup po slugu odwzorowuje wpis z listy', () => {
  const c = geoPages.cities()[0];
  assert.equal(geoPages.cityBySlug(c.voivodeship.slug, c.citySlug), c);
  assert.equal(geoPages.cityBySlug('nieistnieje', 'nieistnieje'), null);

  const x = geoPages.voivodeshipTypes()[0];
  assert.equal(geoPages.voivodeshipTypeBySlug(x.voivodeship.slug, x.type.slug), x);
  assert.equal(geoPages.voivodeshipTypeBySlug('slaskie', 'nieistnieje'), null);
});

test('geoPages: slug miasta jest unikalny w obrębie województwa', () => {
  const seen = new Set();
  for (const c of geoPages.cities()) {
    const key = `${c.voivodeship.slug}/${c.citySlug}`;
    assert.ok(!seen.has(key), `kolizja slugu: ${key}`);
    seen.add(key);
  }
});

test('geoPages: nazwa miasta jest wyświetlana czytelnie, nie WIELKIMI LITERAMI', () => {
  for (const c of geoPages.cities()) {
    assert.notEqual(c.label, c.label.toLocaleUpperCase('pl'), `${c.path}: etykieta WIELKIMI LITERAMI`);
    assert.match(c.path, /^\/baza\/wojewodztwo\/[a-z-]+\/miasto\/[a-z0-9-]+$/);
  }
});
