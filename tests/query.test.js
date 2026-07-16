const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { queryInstitutions, coverageCounts, facetValues } = require('../lib/query');
const { PUBLIC_FIELDS, ADMIN_FIELDS } = require('../lib/projection');

test('queryInstitutions: anonim - tylko pola publiczne, limit 50', () => {
  const result = queryInstitutions(db, { columns: PUBLIC_FIELDS, isAuthorized: false, pageSize: 999 });
  assert.equal(result.pageSize, 50);
  assert.ok(result.rows.length > 0);
  assert.deepEqual(Object.keys(result.rows[0]), PUBLIC_FIELDS);
});

test('queryInstitutions: administrator - wszystkie kolumny, limit do 500', () => {
  const result = queryInstitutions(db, { columns: ADMIN_FIELDS, isAuthorized: true, pageSize: 999 });
  assert.equal(result.pageSize, 500);
  assert.deepEqual(Object.keys(result.rows[0]), ADMIN_FIELDS);
});

test('queryInstitutions: filtr województwa zawęża wyniki i nie miesza województw', () => {
  const result = queryInstitutions(db, {
    columns: PUBLIC_FIELDS,
    filters: { voivodeship: 'ŚLĄSKIE' },
    pageSize: 500,
  });
  assert.ok(result.total > 0);
  assert.ok(result.rows.every((r) => r.voivodeship === 'ŚLĄSKIE'));
});

test('coverageCounts: wypełnione + puste = total dla telefonu, e-maila i WWW', () => {
  const coverage = coverageCounts(db, {});
  const total = queryInstitutions(db, { columns: PUBLIC_FIELDS }).total;

  assert.equal(coverage.total, total);
  for (const key of ['phone', 'email', 'website']) {
    const stats = coverage.fields[key];
    assert.equal(stats.filled + stats.empty, total);
    assert.ok(stats.filled >= 0 && stats.filled <= total);
  }
});

test('coverageCounts: filtry zawężają licznik tak samo jak listę wyników', () => {
  const filters = { voivodeship: 'ŚLĄSKIE' };
  const coverage = coverageCounts(db, { filters });
  const listed = queryInstitutions(db, { columns: PUBLIC_FIELDS, filters });

  assert.equal(coverage.total, listed.total);
  assert.ok(coverage.total < coverageCounts(db, {}).total);
});

test('facetValues: kaskada województwo -> powiat zawęża listę', () => {
  const allCounties = facetValues(db, 'county', {});
  const slaskCounties = facetValues(db, 'county', { voivodeship: 'ŚLĄSKIE' });
  assert.ok(slaskCounties.length < allCounties.length);
  assert.ok(slaskCounties.length > 0);
});
