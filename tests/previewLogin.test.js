// Tryb podglądu (lib/preview.js): środowisko ustawiamy przed załadowaniem aplikacji.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdik-preview-'));
Object.assign(process.env, {
  PREVIEW_LOGIN: 'true',
  PUBLIC_BASE_URL: 'https://bdik.staging.vamude.com',
  DB_PATH: path.join(dir, 'preview.sqlite'),
  SESSION_SECRET: 'test-secret-test-secret-test-secret',
  NODE_ENV: 'test',
});
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

const app = require('../app');
const db = require('../db');

let server;
let base;
test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server && server.close());

test('podgląd: strona logowania pokazuje wejście bez Google', async () => {
  const body = await (await fetch(`${base}/kierownik`)).text();
  assert.match(body, /Wejdź do panelu \(wersja testowa\)/);
  assert.doesNotMatch(body, /Zaloguj się przez Google/);
});

test('podgląd: logowanie zawsze się udaje i otwiera panel administratora', async () => {
  const login = await fetch(`${base}/auth/google`, { redirect: 'manual' });
  assert.equal(login.status, 302);
  assert.equal(login.headers.get('location'), '/kierownik');
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const panel = await fetch(`${base}/kierownik`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(panel.status, 302);
  assert.equal(panel.headers.get('location'), '/kierownik/orders');
  const orders = await fetch(`${base}/kierownik/orders`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(orders.status, 200);
  const user = db.prepare("SELECT role FROM users WHERE email = 'podglad@example.invalid'").get();
  assert.equal(user.role, 'admin');
});

// Start aplikacji w osobnym procesie - sprawdzenie blokady poza podglądem.
function bootWith(env) {
  return spawnSync(process.execPath, ['-e', "require('./lib/preview').assertPreviewHost()"], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('PREVIEW_LOGIN poza podglądem blokuje start (bdik.pl, podrobiony adres)', () => {
  for (const url of ['https://bdik.pl', 'https://staging.vamude.com.evil.example', '']) {
    const r = bootWith({ PUBLIC_BASE_URL: url });
    assert.notEqual(r.status, 0, url);
    assert.match(r.stderr, /PREVIEW_LOGIN=true jest dozwolone tylko na podglądzie/);
  }
});

test('bez PREVIEW_LOGIN produkcja startuje jak dotąd', () => {
  assert.equal(bootWith({ PREVIEW_LOGIN: '', PUBLIC_BASE_URL: 'https://bdik.pl' }).status, 0);
  assert.equal(bootWith({ PUBLIC_BASE_URL: 'https://bdik.staging.vamude.com' }).status, 0);
});
