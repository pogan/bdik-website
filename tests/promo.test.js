const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { countWithContact } = require('../lib/query');
const { priceBreakdown } = require('../lib/pricing');
const { PROMO_PERCENT, promoMaxOffZl, promoLabel } = require('../lib/promo');

test('rabat: 20% od ceny całej bazy brutto, w dół do pełnych złotych', () => {
  assert.equal(PROMO_PERCENT, 20);
  const maxGross = priceBreakdown(countWithContact(db)).gross;
  const off = promoMaxOffZl();
  assert.ok(Number.isInteger(off));
  assert.ok(off * 100 <= maxGross * 0.2, 'nie więcej niż 20% ceny maksymalnej');
  assert.ok((off + 1) * 100 > maxGross * 0.2, 'zaokrąglone w dół, nie niżej');
  assert.equal(promoLabel(), `RABAT DO ${off} zł`);
});
