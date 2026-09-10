const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('../lib/slug');

test('slugify: usuwa polskie znaki i normalizuje separatory', () => {
  assert.equal(slugify('KŁODZKI'), 'klodzki');
  assert.equal(slugify('JELENIOGÓRSKI'), 'jeleniogorski');
  assert.equal(slugify('ŻNIŃSKI'), 'zninski');
  assert.equal(slugify('Warszawa Zachodnia'), 'warszawa-zachodnia');
  assert.equal(slugify('  M. WROCŁAW  '), 'm-wroclaw');
});

test('slugify: nie zostawia wiodących/końcowych myślników', () => {
  assert.equal(slugify('!! test !!'), 'test');
  assert.equal(slugify('---'), '');
});
