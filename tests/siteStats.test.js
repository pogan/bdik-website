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

test('panel /kierownik/stats niedostępny bez logowania administratora', async () => {
  const res = await fetch(`${base}/kierownik/stats`, { redirect: 'manual' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/kierownik?next=%2Fkierownik%2Fstats');
  assert.equal((await fetch(`${base}/kierownik/stats.json`, { redirect: 'manual' })).status, 401);
  // Pod /admin nic nie ma, a robots.txt nie zdradza adresu panelu.
  for (const p of ['/admin', '/admin/orders', '/admin/stats']) {
    assert.equal((await fetch(`${base}${p}`, { redirect: 'manual' })).status, 404, p);
  }
  assert.doesNotMatch(await (await fetch(`${base}/robots.txt`)).text(), /kierownik|admin/);
});

test('archiwum starego licznika i lejek od startu statystyk', () => {
  const a = stats.archive();
  assert.equal(typeof a.visitors, 'number');
  assert.ok(Array.isArray(a.sources));
  assert.match(stats.funnelSince(), /^\d{4}-\d{2}-\d{2}$/);
});

test('eksport starych statystyk do plików (scripts/eksport-starych-statystyk.js)', () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bdik-eksport-'));
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'eksport-starych-statystyk.js'), out], {
    env: process.env,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const csv = fs.readFileSync(path.join(out, 'stary-licznik.csv'), 'utf8');
  assert.match(csv, /^first_seen,last_seen,landing_path,referrer,utm_source,utm_medium,utm_campaign\n/);
  assert.doesNotMatch(csv, /ip_hash/);
  const summary = JSON.parse(fs.readFileSync(path.join(out, 'podsumowanie.json'), 'utf8'));
  assert.ok(Array.isArray(summary.lejek) && summary.lejek.length > 0);
  assert.equal(typeof summary.archiwumStaregoLicznika.visitors, 'number');
  assert.ok(fs.existsSync(path.join(out, 'zdarzenia.csv')));
  fs.rmSync(out, { recursive: true, force: true });
});
