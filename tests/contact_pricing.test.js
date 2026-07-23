const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { countInstitutions, countWithContact, coverageCounts } = require('../lib/query');
const { normalizeSelection } = require('../lib/orders');
const { lineItemName, describeFilters } = require('../lib/pricing');

test('countWithContact: podzbiór wszystkich rekordów, zgodny z pokryciem kanałów', () => {
  const total = countInstitutions(db);
  const billable = countWithContact(db);
  assert.ok(billable > 0, 'w bazie muszą istnieć rekordy z kontaktem');
  assert.ok(billable <= total);

  // Rekordów z JAKIMKOLWIEK kontaktem nie może być mniej niż z samym e-mailem
  // ani więcej niż sumy pojedynczych kanałów.
  const cov = coverageCounts(db, {});
  const perChannel = ['phone', 'email', 'website'].map((c) => cov.fields[c].filled);
  assert.ok(billable >= Math.max(...perChannel));
  assert.ok(billable <= perChannel.reduce((a, b) => a + b, 0));
});

test('filtr contact zawęża wyniki i respektuje pozostałe filtry', () => {
  const all = countInstitutions(db, { filters: { voivodeship: 'POMORSKIE' } });
  const withEmail = countInstitutions(db, { filters: { voivodeship: 'POMORSKIE', contact: 'email' } });
  const withAny = countInstitutions(db, { filters: { voivodeship: 'POMORSKIE', contact: 'any' } });
  assert.ok(withEmail <= withAny);
  assert.ok(withAny <= all);

  // Przy filtrze "tylko z kontaktem" każdy rekord jest płatny.
  const billable = countWithContact(db, { filters: { voivodeship: 'POMORSKIE', contact: 'any' } });
  assert.equal(billable, withAny);
});

test('filtr contact: nieznana wartość jest ignorowana, nie wybucha', () => {
  const all = countInstitutions(db);
  assert.equal(countInstitutions(db, { filters: { contact: "'; DROP TABLE institutions; --" } }), all);
});

test('normalizeSelection przepuszcza filtr contact do zapisu zamówienia', () => {
  const selection = normalizeSelection({ voivodeship: 'POMORSKIE', contact: 'email' });
  assert.equal(selection.filters.contact, 'email');
});

test('lineItemName i describeFilters komunikują rekordy gratis i filtr kontaktu', () => {
  assert.equal(lineItemName('csv', 230, 96), 'Eksport CSV - 230 instytucji kultury (płatne 96 z danymi kontaktowymi, 134 gratis)');
  assert.equal(lineItemName('csv', 96, 96), 'Eksport CSV - 96 instytucji kultury');
  assert.equal(lineItemName('csv', 96), 'Eksport CSV - 96 instytucji kultury');
  assert.match(describeFilters({ voivodeship: 'POMORSKIE', contact: 'any' }), /tylko z danymi kontaktowymi/);
});
