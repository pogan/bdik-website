const test = require('node:test');
const assert = require('node:assert/strict');
const {
  priceFor,
  priceBreakdown,
  breakdownFromNet,
  formatAmount,
  formatPricePerRow,
  describeFilters,
  MIN_AMOUNT,
  MAX_AMOUNT,
} = require('../lib/pricing');

test('priceFor: pusty zestaw wyników kosztuje 0 (nie ma czego sprzedać)', () => {
  assert.equal(priceFor(0), 0);
  assert.equal(priceFor(-5), 0);
  assert.equal(priceFor('nonsens'), 0);
});

test('priceFor: mały wycinek wpada na próg minimalny', () => {
  assert.equal(priceFor(1), MIN_AMOUNT);
  assert.equal(priceFor(15), MIN_AMOUNT); // 15 * 1 zł = 15 zł < 19 zł
});

test('priceFor: progi liczą się kaskadowo, jak progi podatkowe', () => {
  // 100 * 100 = 10000 gr
  assert.equal(priceFor(100), 10000);
  // 100*100 + 400*80 = 10000 + 32000 = 42000 gr
  assert.equal(priceFor(500), 42000);
  // 100*100 + 900*80 = 10000 + 72000 = 82000 gr
  assert.equal(priceFor(1000), 82000);
});

test('priceFor: cena rośnie monotonicznie i nigdy nie przebija sufitu', () => {
  let previous = 0;
  for (const rows of [1, 50, 100, 250, 1000, 5000, 10000, 50000, 200000]) {
    const amount = priceFor(rows);
    assert.ok(amount >= previous, `cena spadła przy ${rows} rekordach`);
    assert.ok(amount <= MAX_AMOUNT, `cena przebiła sufit przy ${rows} rekordach`);
    previous = amount;
  }
  assert.equal(priceFor(1000000), MAX_AMOUNT);
});

test('priceFor: zawsze pełne grosze (Stripe nie przyjmie ułamka)', () => {
  for (const rows of [1, 7, 123, 4567, 98765]) {
    assert.equal(priceFor(rows) % 1, 0);
  }
});

test('breakdownFromNet: ceny w cenniku są netto, VAT 23% doliczany na wierzchu', () => {
  // 19,00 zł netto -> VAT 4,37 zł -> 23,37 zł brutto
  assert.deepEqual(breakdownFromNet(1900), { net: 1900, vat: 437, gross: 2337 });
  assert.deepEqual(breakdownFromNet(0), { net: 0, vat: 0, gross: 0 });
});

test('priceBreakdown: brutto = netto + VAT, a VAT to pełne grosze', () => {
  const bd = priceBreakdown(100); // netto 10000 gr
  assert.equal(bd.net, 10000);
  assert.equal(bd.vat, 2300); // 10000 * 0,23
  assert.equal(bd.gross, 12300);
  assert.equal(bd.gross, bd.net + bd.vat);
  assert.equal(bd.vat % 1, 0);
});

test('priceBreakdown: pusty zestaw jest darmowy, a cena za rekord to średnia netto', () => {
  assert.equal(priceBreakdown(0).gross, 0);
  const bd = priceBreakdown(500); // netto 42000 gr
  assert.equal(bd.net, 42000);
  assert.equal(bd.perRow, 42000 / 500);
});

test('formatPricePerRow: ułamek grosza z trzema miejscami po przecinku', () => {
  assert.equal(formatPricePerRow(19.58), '0,196 zł');
  assert.equal(formatPricePerRow(0), '0,000 zł');
});

test('formatAmount: kwota po polsku, z przecinkiem', () => {
  assert.equal(formatAmount(1900), '19,00 zł');
  assert.equal(formatAmount(8500), '85,00 zł');
});

test('describeFilters: czytelny opis zakresu, także gdy filtrów brak', () => {
  assert.equal(describeFilters({}), 'cała baza (bez filtrów)');
  assert.equal(
    describeFilters({ voivodeship: 'POMORSKIE', county: 'gdański', q: 'biblioteka' }),
    'woj. pomorskie · pow. gdański · "biblioteka"'
  );
});
