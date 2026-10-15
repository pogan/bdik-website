const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../app');
const geoPages = require('../lib/geoPages');
const guides = require('../lib/guides');

let server;
let base;

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server && server.close());

async function get(path) {
  const res = await fetch(base + path, { redirect: 'manual' });
  const body = res.status === 200 ? await res.text() : '';
  return { status: res.status, body };
}

test('strony segmentów, FAQ i poradniki zwracają 200 z canonicalem', async () => {
  const city = geoPages.cities()[0];
  const cross = geoPages.voivodeshipTypes()[0];
  const paths = [
    '/baza',
    '/faq',
    '/poradniki',
    '/baza/wojewodztwo/slaskie',
    '/baza/typ/biblioteki',
    city.path,
    cross.path,
    ...guides.all().map((g) => `/poradniki/${g.slug}`),
  ];
  for (const p of paths) {
    const { status, body } = await get(p);
    assert.equal(status, 200, `${p} -> ${status}`);
    assert.match(body, /<link rel="canonical"/, `${p}: brak canonical`);
    assert.match(body, /"@type":"BreadcrumbList"|"@type":"Dataset"|"@type":"FAQPage"/, `${p}: brak JSON-LD`);
  }
});

test('nieznane slugi segmentów zwracają 404', async () => {
  for (const p of [
    '/baza/wojewodztwo/nieistnieje',
    '/baza/typ/nieistnieje',
    '/baza/wojewodztwo/slaskie/miasto/nieistnieje',
    '/baza/wojewodztwo/nieistnieje/powiat/kutnowski',
    '/baza/wojewodztwo/slaskie/typ/nieistnieje',
    '/poradniki/nieistnieje',
  ]) {
    const { status } = await get(p);
    assert.equal(status, 404, `${p} -> ${status}`);
  }
});

test('sitemap.xml zawiera nowe strony i tylko indeksowalne trasy', async () => {
  const { body } = await get('/sitemap.xml');
  assert.match(body, /\/faq</);
  assert.match(body, /\/poradniki</);
  assert.match(body, new RegExp(geoPages.cities()[0].path.replace(/\//g, '\\/')));
  assert.doesNotMatch(body, /\/admin|\/platnosc|\/pobierz/);
  assert.doesNotMatch(body, /\/powiat\//, 'dawne strony powiatów nie mogą wracać do sitemapy');
  assert.doesNotMatch(body, /<changefreq>|<priority>/);
  // lastmod per strona, nie jedna globalna data dla wszystkich adresów.
  for (const m of body.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) assert.match(m[1], /^\d{4}-\d{2}-\d{2}$/);
});

test('/faq ma FAQPage, a /baza już nie (bez duplikacji danych strukturalnych)', async () => {
  assert.match((await get('/faq')).body, /"@type":"FAQPage"/);
  assert.doesNotMatch((await get('/baza')).body, /"@type":"FAQPage"/);
});

test('strony segmentów renderują treść widoczną bez JS (pełna lista + rozkład)', async () => {
  const { body } = await get('/baza/wojewodztwo/slaskie');
  assert.match(body, /Lista instytucji kultury w województwie śląskim/);
  assert.match(body, /według typu/);
  assert.match(body, /Dane w stanie z dnia/);
  assert.match(body, /Najwięcej instytucji jest w miejscowościach/);
  // Krótka informacja o cenie zamiast pełnego cennika (ten zostaje na /baza).
  assert.doesNotMatch(body, /id="cennik"/);
  assert.match(body, /href="\/baza#cennik"/);
});

test('duże segmenty (typ w całej Polsce) zostają przy próbce zamiast pełnej listy', async () => {
  const { body } = await get('/baza/typ/domy-kultury');
  assert.match(body, /Przykładowe instytucje/);
  assert.doesNotMatch(body, /class="container py-4 segment-list"/);
});

test('lista na stronie segmentu nie ujawnia wartości kontaktowych', async () => {
  const db = require('../db');
  const city = geoPages.cities()[0];
  const rows = db
    .prepare('SELECT phone, email, website FROM institutions WHERE voivodeship = ? AND locality = ?')
    .all(city.voivodeship.value, city.localityValue);
  const { body } = await get(city.path);
  assert.match(body, /bi-telephone/);
  for (const r of rows) {
    if (r.email) assert.ok(!body.includes(r.email), `e-mail ${r.email} w HTML`);
    if (r.phone) assert.ok(!body.includes(r.phone), `telefon ${r.phone} w HTML`);
  }
});

test('dawne strony powiatów przekierowują 301 na województwo lub miasto', async () => {
  const res = await fetch(`${base}/baza/wojewodztwo/lodzkie/powiat/kutnowski`, { redirect: 'manual' });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/baza/wojewodztwo/lodzkie');

  const city = geoPages.cities()[0];
  const res2 = await fetch(`${base}/baza/wojewodztwo/${city.voivodeship.slug}/powiat/${city.citySlug}`, { redirect: 'manual' });
  assert.equal(res2.status, 301);
  assert.equal(res2.headers.get('location'), city.path);
});
