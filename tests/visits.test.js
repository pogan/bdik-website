const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../db');
const { recordVisit, recordEvent, isClientEvent, isKnownEvent, EVENTS } = require('../lib/visits');

// Te same adresy co dokumentacyjne zakresy TEST-NET - nie kolidują z niczym
// prawdziwym; po każdym teście sprzątamy wiersze po hashu.
function hashIp(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

function cleanup(ip) {
  const h = hashIp(ip);
  db.prepare('DELETE FROM visits WHERE ip_hash = ?').run(h);
  db.prepare('DELETE FROM events WHERE ip_hash = ?').run(h);
  db.prepare('DELETE FROM event_log WHERE ip_hash = ?').run(h);
}

test('recordVisit: źródło zapisywane przy pierwszej wizycie, nie nadpisywane przy kolejnych', () => {
  const ip = '203.0.113.10';
  cleanup(ip);

  recordVisit(ip, {
    referrer: 'https://www.facebook.com/',
    utmSource: 'facebook',
    utmMedium: 'social',
    utmCampaign: 'lipiec',
    landingPath: '/baza',
  });
  recordVisit(ip, { referrer: 'https://www.google.com/', utmSource: 'google', landingPath: '/regulamin' });

  const row = db.prepare('SELECT * FROM visits WHERE ip_hash = ?').get(hashIp(ip));
  assert.equal(row.utm_source, 'facebook');
  assert.equal(row.utm_medium, 'social');
  assert.equal(row.utm_campaign, 'lipiec');
  assert.equal(row.referrer, 'https://www.facebook.com/');
  assert.equal(row.landing_path, '/baza');

  cleanup(ip);
});

test('recordEvent: liczy osoby w events i każde wystąpienie w event_log z metadanymi', () => {
  const ip = '203.0.113.11';
  cleanup(ip);

  assert.equal(recordEvent(ip, 'quote_view', { format: 'csv', rows: 120, gross: 12300 }), true);
  assert.equal(recordEvent(ip, 'quote_view', { format: 'xlsx', rows: 5, gross: 2337 }), true);

  const person = db.prepare("SELECT hits FROM events WHERE ip_hash = ? AND name = 'quote_view'").get(hashIp(ip));
  assert.equal(person.hits, 2);

  const logs = db
    .prepare("SELECT meta FROM event_log WHERE ip_hash = ? AND name = 'quote_view' ORDER BY id")
    .all(hashIp(ip));
  assert.equal(logs.length, 2);
  assert.equal(JSON.parse(logs[0].meta).gross, 12300);
  assert.equal(JSON.parse(logs[1].meta).format, 'xlsx');

  cleanup(ip);
});

test('recordEvent: odrzuca zdarzenia spoza zamkniętej listy', () => {
  const ip = '203.0.113.12';
  cleanup(ip);
  assert.equal(recordEvent(ip, 'wymyslone'), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM event_log WHERE ip_hash = ?').get(hashIp(ip)).n, 0);
});

test('zdarzenia serwerowe nie są przyjmowane z przeglądarki, klienckie tak', () => {
  for (const name of ['quote_view', 'checkout_start']) {
    assert.equal(isKnownEvent(name), true);
    assert.equal(isClientEvent(name), false);
  }
  for (const name of ['filter_change', 'sample_download', 'export_modal', 'consents_ok']) {
    assert.equal(isKnownEvent(name), true);
    assert.equal(isClientEvent(name), true);
  }
  // Każde zdarzenie z listy ma etykietę dla panelu statystyk.
  for (const label of Object.values(EVENTS)) assert.equal(typeof label, 'string');
});
