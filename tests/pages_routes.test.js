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
  const county = geoPages.counties()[0];
  const cross = geoPages.voivodeshipTypes()[0];
  const paths = [
    '/baza',
    '/faq',
    '/poradniki',
    '/baza/wojewodztwo/slaskie',
    '/baza/typ/biblioteki',
    county.path,
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
    '/baza/wojewodztwo/slaskie/powiat/nieistnieje',
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
  assert.match(body, new RegExp(geoPages.counties()[0].path.replace(/\//g, '\\/')));
  assert.doesNotMatch(body, /\/admin|\/platnosc|\/pobierz/);
});

test('/faq ma FAQPage, a /baza już nie (bez duplikacji danych strukturalnych)', async () => {
  assert.match((await get('/faq')).body, /"@type":"FAQPage"/);
  assert.doesNotMatch((await get('/baza')).body, /"@type":"FAQPage"/);
});

test('strony segmentów renderują treść widoczną bez JS (próbka + rozkład)', async () => {
  const { body } = await get('/baza/wojewodztwo/slaskie');
  assert.match(body, /Przykładowe instytucje/);
  assert.match(body, /według typu/);
  assert.match(body, /Dane w stanie z dnia/);
});
