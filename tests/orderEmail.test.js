const test = require('node:test');
const assert = require('node:assert/strict');
const { buildConfirmationEmail } = require('../lib/orderEmail');

function fakeOrder(overrides = {}) {
  return {
    token: 'a'.repeat(48),
    stripe_payment_intent: 'pi_test_ABC',
    format: 'csv',
    row_count: 120,
    amount: 12000, // netto w groszach
    filters: JSON.stringify({ filters: { voivodeship: 'POMORSKIE' }, q: 'biblioteka' }),
    terms_version: '2026-07-15',
    ...overrides,
  };
}

const seller = { name: 'Sprzedawca Sp. z o.o.', address: 'ul. Testowa 1, 00-001 Miasto', nip: '5932472450', email: 'kontakt@example.com' };

test('buildConfirmationEmail: zawiera numer zamówienia, link i pouczenia', () => {
  const { subject, text, html } = buildConfirmationEmail(fakeOrder(), {
    downloadUrl: 'https://example.pl/pobierz/pi_test_ABC',
    seller,
    termsUrl: 'https://example.pl/regulamin/2026-07-15',
  });

  assert.match(subject, /Potwierdzenie zakupu/);
  // Numer zamówienia (do reklamacji).
  assert.match(text, /pi_test_ABC/);
  assert.match(html, /pi_test_ABC/);
  // Link do pobrania.
  assert.match(text, /example\.pl\/pobierz\/pi_test_ABC/);
  // Pouczenie o utracie prawa odstąpienia.
  assert.match(text, /tracisz prawo odstąpienia/i);
  // Warunki licencji.
  assert.match(text, /odsprzedaw/i);
  assert.match(text, /użytku własnego/i);
  // Wersja regulaminu z chwili zakupu.
  assert.match(text, /regulamin\/2026-07-15/);
  // Dane sprzedawcy.
  assert.match(text, /5932472450/);
});

test('buildConfirmationEmail: rozbicie kwoty netto/VAT/brutto', () => {
  const { text } = buildConfirmationEmail(fakeOrder({ amount: 10000 }), { downloadUrl: 'https://x/pobierz/pi', seller });
  // 100,00 netto + 23,00 VAT = 123,00 brutto.
  assert.match(text, /123,00 zł brutto/);
  assert.match(text, /netto 100,00 zł/);
  assert.match(text, /VAT 23,00 zł/);
});

test('buildConfirmationEmail: bez linku podaje instrukcję zastępczą', () => {
  const { text } = buildConfirmationEmail(fakeOrder(), { seller });
  assert.match(text, /stronie potwierdzenia/i);
});
