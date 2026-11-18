const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const orders = require('../lib/orders');
const campaign = require('../lib/campaignStats');
const { priceFor } = require('../lib/pricing');
const { recordEvent } = require('../lib/visits');

test('północ w Warszawie jako UTC: czas zimowy i letni', () => {
  assert.equal(campaign.warsawMidnightUtc('2026-11-24'), '2026-11-23 23:00:00');
  assert.equal(campaign.warsawMidnightUtc('2026-07-01'), '2026-06-30 22:00:00');
});

test('sekcja sprzedaży: zamówienia i źródła w okresie, bez zamówień administratora', () => {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
  const before = campaign.campaignData({ from: day, to: day });
  const selection = orders.normalizeSelection({ voivodeship: 'POMORSKIE' });
  const base = { format: 'csv', selection, rowCount: 10, billedCount: 10, amount: priceFor(10), currency: 'pln' };
  db.transaction(() => {
    orders.createOrder({ ...base, source: { utmCampaign: 'test-kampania-sekcji', utmSource: 'facebook' } });
    orders.createOrder({ ...base, createdByAdmin: true, source: { utmCampaign: 'test-kampania-sekcji' } });
  }).immediate();
  recordEvent('203.0.113.77', 'quote_view', { gross: 3000 });
  const after = campaign.campaignData({ from: day, to: day });
  const created = (d) => d.funnel.find((r) => r.label === 'Założone zamówienia').value;
  assert.equal(created(after) - created(before), 1);
  const src = after.sources.find((s) => s.source === 'test-kampania-sekcji');
  assert.equal(src.created, 1);
  assert.ok(after.quotes.some((q) => q.label === '25–50 zł'));
  assert.ok(after.daily.some((d) => d.day === day && d.created >= 1));
  // Okres sprzed powstania zamówień: nic z dzisiejszych danych.
  assert.equal(campaign.campaignData({ from: '2020-01-01', to: '2020-01-31' }).sources.length, 0);
  // HTML: nazwy źródeł z zewnątrz są escapowane.
  assert.match(campaign.render({ from: day, to: day }), /Zamówienia według źródła/);
});
