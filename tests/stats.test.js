const test = require('node:test');
const assert = require('node:assert/strict');
const orders = require('../lib/orders');
const stats = require('../lib/stats');
const { priceFor } = require('../lib/pricing');

function funnelValue(label) {
  return stats.funnel().find((r) => r.label === label).value;
}

function newOrder(overrides = {}) {
  const selection = orders.normalizeSelection({ voivodeship: 'POMORSKIE' });
  return orders.createOrder({
    format: 'csv',
    selection,
    rowCount: 50,
    billedCount: 48,
    amount: priceFor(48),
    currency: 'pln',
    ...overrides,
  });
}

test('statystyki pomijają zamówienia administratora, liczą pozostałe', () => {
  const before = funnelValue('Założone zamówienia');
  const beforePaid = funnelValue('Opłacone zamówienia');

  const adminOrder = newOrder({ createdByAdmin: true });
  assert.equal(adminOrder.created_by_admin, 1);
  orders.markPaid(adminOrder, { paymentIntent: 'pi_stats_admin_test' });
  assert.equal(funnelValue('Założone zamówienia'), before);
  assert.equal(funnelValue('Opłacone zamówienia'), beforePaid);

  const clientOrder = newOrder();
  assert.equal(clientOrder.created_by_admin, 0);
  assert.equal(funnelValue('Założone zamówienia'), before + 1);
});
