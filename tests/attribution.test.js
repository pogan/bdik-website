const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../app');
const db = require('../db');
const orders = require('../lib/orders');
const { sourceFor, describeSource, sourceKey } = require('../lib/attribution');

let server;
let base;
test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server && server.close());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const fakeReq = (ip, ua = UA) => ({ ip, get: (h) => ({ 'user-agent': ua })[h.toLowerCase()] });

async function visit(path, ip) {
  const res = await fetch(base + path, {
    headers: { 'user-agent': UA, 'accept-language': 'pl-PL,pl;q=0.9', 'x-forwarded-for': ip },
  });
  await res.text();
  await new Promise((r) => setTimeout(r, 50)); // odsłona zapisuje się po 'finish'
}

test('źródło zamówienia: ostatnie wejście z UTM tej samej osoby (zgodność z vamude-kit)', async () => {
  const ip = '203.0.113.7';
  await visit('/baza?utm_source=facebook&utm_medium=social&utm_campaign=bdik27_test_a', ip);
  await visit('/baza?utm_source=linkedin&utm_medium=social&utm_campaign=bdik27_test_b', ip);
  await visit('/poradniki', ip); // przejście wewnętrzne nie nadpisuje źródła

  const src = sourceFor(fakeReq(ip));
  assert.ok(src, 'brak dopasowania - wzór identyfikatora rozjechał się z vamude-kit?');
  assert.equal(src.utmCampaign, 'bdik27_test_b');
  assert.equal(src.utmSource, 'linkedin');

  assert.equal(sourceFor(fakeReq('198.51.100.9')), null, 'inna osoba (IP) nie dostaje cudzego źródła');
});

test('wejście sprzed ponad 30 dni się nie liczy', async () => {
  const ip = '203.0.113.8';
  await visit('/baza?utm_source=facebook&utm_campaign=bdik27_stare', ip);
  const later = Date.now() + 31 * 24 * 60 * 60 * 1000;
  assert.equal(sourceFor(fakeReq(ip), later), null);
});

test('createOrder zapisuje źródło, panel je opisuje', () => {
  db.exec('BEGIN');
  try {
    const order = orders.createOrder({
      format: 'csv', selection: { filters: {}, q: '' }, rowCount: 1, billedCount: 1, amount: 1900, currency: 'pln',
      source: { utmSource: 'facebook', utmMedium: 'social', utmCampaign: 'bdik27_2411_start', referrerHost: null, seenAt: '2026-11-24T19:00:00.000Z' },
    });
    assert.equal(order.source_utm_campaign, 'bdik27_2411_start');
    assert.equal(describeSource(order), 'bdik27_2411_start · facebook/social');
    assert.equal(sourceKey(order), 'bdik27_2411_start');

    const plain = orders.createOrder({ format: 'csv', selection: { filters: {}, q: '' }, rowCount: 1, amount: 1900, currency: 'pln' });
    assert.equal(describeSource(plain), null);
    assert.equal(sourceKey(plain), '(bez źródła)');
  } finally {
    db.exec('ROLLBACK');
  }
});
