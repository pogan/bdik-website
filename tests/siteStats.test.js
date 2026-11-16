const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const db = require('../db');
const app = require('../app');
const stats = require('../lib/stats');

let server;
let base;

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server && server.close());

const BROWSER = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'accept-language': 'pl-PL,pl;q=0.9',
};
// Testowe adresy z TEST-NET-3; wiersze vk_pageviews sprzątamy po ścieżce.
const PATH = '/faq';
const cleanup = () => db.prepare('DELETE FROM vk_pageviews WHERE path = ?').run(PATH);
const settle = () => new Promise((r) => setTimeout(r, 30));

test('/healthz w formacie vamude-kit, z kontrolą bazy', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.app, 'bdik-website');
  assert.deepEqual(body.checks, { db: 'ok' });
});

test('odsłony: człowiek liczony, bot z flagą, stara tabela visits nie rośnie', async () => {
  cleanup();
  const archived = db.prepare('SELECT COUNT(*) AS n FROM visits').get().n;
  await fetch(base + PATH, { headers: { ...BROWSER, 'x-forwarded-for': '203.0.113.50' } });
  await fetch(base + PATH, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'accept-language': 'en' } });
  await settle();
  const rows = db.prepare('SELECT is_bot FROM vk_pageviews WHERE path = ? ORDER BY id').all(PATH);
  assert.deepEqual(rows.map((r) => r.is_bot), [0, 1]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM visits').get().n, archived);
  // Lejek zaczyna się od unikalnych osób z vamude-kit (bez botów).
  assert.ok(stats.funnel()[0].value >= 1);
  cleanup();
});

test('panel /admin/odwiedziny niedostępny bez logowania administratora', async () => {
  const res = await fetch(`${base}/admin/odwiedziny`, { redirect: 'manual' });
  assert.notEqual(res.status, 200);
  assert.notEqual((await fetch(`${base}/admin/odwiedziny.json`, { redirect: 'manual' })).status, 200);
});

test('archiwum starego licznika i lejek od startu statystyk', () => {
  const a = stats.archive();
  assert.equal(typeof a.visitors, 'number');
  assert.ok(Array.isArray(a.sources));
  assert.match(stats.funnelSince(), /^\d{4}-\d{2}-\d{2}$/);
});
