const test = require('node:test');
const assert = require('node:assert/strict');
const orders = require('../lib/orders');
const { priceFor } = require('../lib/pricing');

function newOrder(overrides = {}) {
  const selection = orders.normalizeSelection({ voivodeship: 'POMORSKIE', q: 'biblioteka' });
  return orders.createOrder({
    format: 'csv',
    selection,
    rowCount: 120,
    amount: priceFor(120),
    currency: 'pln',
    ...overrides,
  });
}

test('normalizeSelection: przepuszcza tylko znane filtry i przycina białe znaki', () => {
  const selection = orders.normalizeSelection({
    voivodeship: '  POMORSKIE ',
    locality: '',
    q: '  biblioteka ',
    order: 'desc',
    sort: 'locality',
    evil: "'; DROP TABLE institutions; --",
  });

  assert.deepEqual(selection.filters, { voivodeship: 'POMORSKIE' });
  assert.equal(selection.q, 'biblioteka');
  assert.equal(selection.sort, 'locality');
  assert.equal(selection.order, 'desc');
  assert.ok(!('evil' in selection.filters));
});

test('normalizeSelection: nieznany kierunek sortowania spada na "asc"', () => {
  assert.equal(orders.normalizeSelection({ order: 'boom' }).order, 'asc');
});

test('nowe zamówienie jest "pending" i nie daje prawa do pobrania', () => {
  const order = newOrder();
  assert.equal(order.status, 'pending');
  assert.deepEqual(orders.downloadState(order), { ok: false, reason: 'unpaid' });
});

test('dopiero markPaid otwiera pobieranie, a kryteria przeżywają zapis do bazy', () => {
  const paid = orders.markPaid(newOrder(), { paymentIntent: 'pi_test_1', email: 'kupujacy@example.com' });

  assert.equal(paid.status, 'paid');
  assert.equal(paid.stripe_payment_intent, 'pi_test_1');
  assert.ok(orders.downloadState(paid).ok);

  const selection = orders.parseSelection(paid);
  assert.deepEqual(selection.filters, { voivodeship: 'POMORSKIE' });
  assert.equal(selection.q, 'biblioteka');
});

test('opłacone zamówienie jest stanem końcowym - spóźniony webhook go nie unieważni', () => {
  const paid = orders.markPaid(newOrder());
  const afterExpiry = orders.markStatus(paid, 'expired');

  assert.equal(afterExpiry.status, 'paid');
  assert.ok(orders.downloadState(afterExpiry).ok);
});

test('limit pobrań wyczerpuje się po MAX_DOWNLOADS', () => {
  const paid = orders.markPaid(newOrder());
  for (let i = 0; i < orders.MAX_DOWNLOADS; i += 1) {
    assert.ok(orders.downloadState(orders.findByToken(paid.token)).ok, `pobranie ${i + 1} powinno przejść`);
    orders.registerDownload(paid);
  }

  const exhausted = orders.findByToken(paid.token);
  assert.deepEqual(orders.downloadState(exhausted), { ok: false, reason: 'limit' });
});

test('findByToken nie daje się nabrać na token spoza formatu', () => {
  assert.equal(orders.findByToken("' OR 1=1 --"), undefined);
  assert.equal(orders.findByToken('krotki'), undefined);
});

test('findByPaymentIntent znajduje zamówienie po numerze transakcji Stripe', () => {
  const pi = `pi_${Date.now()}Abc`;
  const paid = orders.markPaid(newOrder(), { paymentIntent: pi });

  assert.equal(orders.findByPaymentIntent(pi).id, paid.id);
  // Numer reklamacyjny to jedyny publiczny identyfikator - format musi się zgadzać.
  assert.equal(orders.findByPaymentIntent("pi_'; DROP TABLE orders; --"), undefined);
  assert.equal(orders.findByPaymentIntent('ch_123'), undefined);
});

test('findByDownloadId przyjmuje zarówno pi_..., jak i stary token', () => {
  const pi = `pi_${Date.now()}Xyz`;
  const paid = orders.markPaid(newOrder(), { paymentIntent: pi });

  assert.equal(orders.findByDownloadId(pi).id, paid.id);
  assert.equal(orders.findByDownloadId(paid.token).id, paid.id);
  assert.equal(orders.findByDownloadId('cokolwiek'), undefined);
});

test('link do pobrania wygasa po DOWNLOAD_TTL_HOURS (24 h)', () => {
  assert.equal(orders.DOWNLOAD_TTL_HOURS, 24);

  const paid = orders.markPaid(newOrder());
  assert.ok(orders.downloadState(paid).ok);

  // Cofamy paid_at o 25 h - poza oknem ważności linku.
  const stale = `${new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')}`;
  require('../db').prepare('UPDATE orders SET paid_at = ? WHERE id = ?').run(stale, paid.id);
  assert.deepEqual(orders.downloadState(orders.findByToken(paid.token)), { ok: false, reason: 'expired' });
});

test('rememberEvent: to samo zdarzenie Stripe przetwarzamy tylko raz', () => {
  const id = `evt_${Date.now()}`;
  assert.equal(orders.rememberEvent(id, 'checkout.session.completed'), true);
  assert.equal(orders.rememberEvent(id, 'checkout.session.completed'), false);
});

test('validateConsents: bez zgód, z false lub ze stringiem "true" - odmowa', () => {
  assert.equal(orders.validateConsents({}).ok, false);
  assert.equal(orders.validateConsents({ termsAccepted: true }).ok, false);
  assert.equal(orders.validateConsents({ withdrawalConsent: true }).ok, false);
  assert.equal(orders.validateConsents({ termsAccepted: false, withdrawalConsent: false }).ok, false);
  // Spreparowane żądanie ze stringami nie może przejść (wymagamy literalnego true).
  assert.equal(orders.validateConsents({ termsAccepted: 'true', withdrawalConsent: 'true' }).ok, false);
});

test('validateConsents: oba oświadczenia jako true - zgoda', () => {
  assert.deepEqual(orders.validateConsents({ termsAccepted: true, withdrawalConsent: true }), { ok: true });
});

test('createOrder: zapisuje wersję regulaminu i znaczniki zgód', () => {
  const order = newOrder({ termsVersion: '2026-07-15' });
  assert.equal(order.terms_version, '2026-07-15');
  assert.ok(order.terms_accepted_at, 'terms_accepted_at powinno być ustawione');
  assert.ok(order.withdrawal_consent_at, 'withdrawal_consent_at powinno być ustawione');
});

test('claimConfirmationEmail: zajmuje wysyłkę dokładnie raz (obrona przed dublem)', () => {
  const paid = orders.markPaid(newOrder(), { paymentIntent: 'pi_mail_1', email: 'k@example.com' });
  assert.equal(orders.claimConfirmationEmail(paid), true);
  // Drugie wywołanie (np. z wyścigu webhook vs. synchronizacja) nic nie zajmuje.
  assert.equal(orders.claimConfirmationEmail(orders.findByToken(paid.token)), false);
});

test('saveBilling: zapisuje dane do faktury pobrane ze Stripe', () => {
  const paid = orders.markPaid(newOrder(), { paymentIntent: 'pi_bill_1' });
  const updated = orders.saveBilling(paid, { name: 'Firma X', taxId: 'PL1234563218', address: 'ul. A 1, 00-001 Warszawa, PL' });
  assert.equal(updated.billing_name, 'Firma X');
  assert.equal(updated.billing_tax_id, 'PL1234563218');
  assert.match(updated.billing_address, /Warszawa/);
});
