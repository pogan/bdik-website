// Filtr statusu w panelu zamówień. Logujemy się trybem podglądu (lib/preview.js),
// więc środowisko ustawiamy przed załadowaniem aplikacji.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdik-admin-orders-'));
Object.assign(process.env, {
  PREVIEW_LOGIN: 'true',
  PUBLIC_BASE_URL: 'https://bdik.staging.vamude.com',
  DB_PATH: path.join(dir, 'admin-orders.sqlite'),
  SESSION_SECRET: 'test-secret-test-secret-test-secret',
  NODE_ENV: 'test',
});
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../app');
const orders = require('../lib/orders');
const { priceFor } = require('../lib/pricing');

function newOrder(rowCount) {
  return orders.createOrder({
    format: 'csv',
    selection: orders.normalizeSelection({ q: 'biblioteka' }),
    rowCount,
    amount: priceFor(rowCount),
    currency: 'pln',
  });
}

let server;
let base;
let cookie;
test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/auth/google`, { redirect: 'manual' });
  cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

  orders.markPaid(newOrder(101), { paymentIntent: 'pi_test_oplacone' });
  orders.markPaid(newOrder(102), { paymentIntent: 'pi_test_oplacone2' });
  newOrder(103);
  orders.markStatus(newOrder(104), 'expired');
});
test.after(() => server && server.close());

async function page(query = '') {
  const res = await fetch(`${base}/admin/orders${query}`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(res.status, 200);
  return res.text();
}

// Wiersze widoczne na starcie (serwer wysyła wszystkie, ukryte mają d-none).
const shown = (body) =>
  [...body.matchAll(/<tr data-status="\w+"( class="d-none")?>[\s\S]*?CSV · (\d+)/g)]
    .filter((m) => !m[1])
    .map((m) => Number(m[2]))
    .sort();
const sent = (body) => [...body.matchAll(/CSV · (\d+)/g)].length;

test('bez filtra panel pokazuje wszystkie zamówienia i liczniki statusów', async () => {
  const body = await page();
  assert.deepEqual(shown(body), [101, 102, 103, 104]);
  assert.match(body, /opłacone <span class="badge[^"]*">2</);
  assert.match(body, /oczekuje <span class="badge[^"]*">1</);
  assert.match(body, /wygasłe <span class="badge[^"]*">1</);
});

test('?status=paid na starcie pokazuje tylko opłacone', async () => {
  const body = await page('?status=paid');
  assert.deepEqual(shown(body), [101, 102]);
  assert.equal(sent(body), 4, 'pozostałe wiersze są w stronie, tylko ukryte');
  assert.match(body, /2 z 4<\/span> zamówień/);
});

test('?status=expired pokazuje tylko wygasłe', async () => {
  assert.deepEqual(shown(await page('?status=expired')), [104]);
});

test('status bez zamówień pokazuje pusty stan', async () => {
  const body = await page('?status=failed');
  assert.deepEqual(shown(body), []);
  assert.match(body, /<div id="orders-empty" class="card">/);
  assert.match(body, /id="orders-table" class="[^"]*d-none"/);
});

test('nieznany status jest ignorowany (wszystkie zamówienia)', async () => {
  assert.deepEqual(shown(await page('?status=%3Cscript%3E')), [101, 102, 103, 104]);
});
