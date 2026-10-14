const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { countInstitutions, countWithContact, coverageCounts } = require('../lib/query');
const { normalizeSelection } = require('../lib/orders');
const { lineItemName, describeFilters } = require('../lib/pricing');

test('countWithContact: podzbiór wszystkich rekordów, zgodny z pokryciem telefonu i e-maila', () => {
  const total = countInstitutions(db);
  const billable = countWithContact(db);
  assert.ok(billable > 0, 'w bazie muszą istnieć rekordy z kontaktem');
  assert.ok(billable <= total);

  // Płatne = telefon LUB e-mail: nie mniej niż rekordów z samym telefonem czy
  // samym e-mailem i nie więcej niż suma obu kanałów. WWW nie wchodzi do wyceny.
  const cov = coverageCounts(db, {});
  const perChannel = ['phone', 'email'].map((c) => cov.fields[c].filled);
  assert.ok(billable >= Math.max(...perChannel));
  assert.ok(billable <= perChannel.reduce((a, b) => a + b, 0));
});

// Rekordy testowe wstawiamy w transakcji cofanej na końcu - nic nie zostaje
// w bazie, a równolegle działające pliki testowe (osobne połączenia) ich nie widzą.
function withFixtures(rows, fn) {
  const insert = db.prepare(`
    INSERT INTO institutions (regon, name, name_normalized, voivodeship, locality, phone, email, website)
    VALUES (@regon, @name, @name, 'TESTOWE', 'TESTOWO', @phone, @email, @website)
  `);
  db.exec('BEGIN');
  try {
    rows.forEach((r) => insert.run({ phone: null, email: null, website: null, ...r }));
    fn({ voivodeship: 'TESTOWE' });
  } finally {
    db.exec('ROLLBACK');
  }
}

test('rekord z samą stroną WWW trafia do pliku gratis, telefon albo e-mail wystarcza do płatności', () => {
  withFixtures(
    [
      { regon: '999999901', name: 'TESTOWY OŚRODEK TYLKO WWW', website: 'https://example.pl' },
      { regon: '999999902', name: 'TESTOWY OŚRODEK TYLKO TELEFON', phone: '+48111111111' },
      { regon: '999999903', name: 'TESTOWY OŚRODEK TYLKO E-MAIL', email: 'kontakt@example.pl' },
      { regon: '999999904', name: 'TESTOWY OŚRODEK PUSTY TELEFON', phone: '   ', website: 'https://example.com' },
    ],
    (filters) => {
      assert.equal(countInstitutions(db, { filters }), 4);
      assert.equal(countWithContact(db, { filters }), 2);
      // Filtr "tylko z kontaktem" to ten sam warunek co płatność - rekordy z samym
      // WWW odpadają, ale zostają osiągalne filtrem "tylko ze stroną WWW".
      assert.equal(countInstitutions(db, { filters: { ...filters, contact: 'any' } }), 2);
      assert.equal(countInstitutions(db, { filters: { ...filters, contact: 'website' } }), 2);
    }
  );
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
  assert.equal(lineItemName('csv', 230, 96), 'Eksport CSV - 230 instytucji kultury (płatne 96 z telefonem lub e-mailem, 134 gratis)');
  assert.equal(lineItemName('csv', 96, 96), 'Eksport CSV - 96 instytucji kultury');
  assert.equal(lineItemName('csv', 96), 'Eksport CSV - 96 instytucji kultury');
  assert.match(describeFilters({ voivodeship: 'POMORSKIE', contact: 'any' }), /tylko z danymi kontaktowymi/);
});
