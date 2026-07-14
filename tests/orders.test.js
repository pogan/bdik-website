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

test('rememberEvent: to samo zdarzenie Stripe przetwarzamy tylko raz', () => {
  const id = `evt_${Date.now()}`;
  assert.equal(orders.rememberEvent(id, 'checkout.session.completed'), true);
  assert.equal(orders.rememberEvent(id, 'checkout.session.completed'), false);
});
