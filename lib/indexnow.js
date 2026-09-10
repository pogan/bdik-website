// IndexNow - powiadamia wyszukiwarki o zmienionych adresach zaraz po zmianie,
// zamiast czekać na kolejne przejście crawlera. Uczestniczą Bing (i tym samym
// Copilot / częściowo ChatGPT Search), Yandex, Seznam, Naver; Google NIE.
//
// Klucz jest półjawny z założenia: plik public/<KEY>.txt musi być publicznie
// dostępny i zawierać dokładnie ten string - to on potwierdza kontrolę nad
// domeną. Zmiana klucza = zmiana stałej TUTAJ i nazwy pliku w public/.
const https = require('node:https');
const { baseUrl } = require('./seo');

const KEY = '405a103867e6a57669a3ee6888a6bec5';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

// Adresy treściowe, które realnie zmieniają się przy odświeżeniu danych
// (liczby, próbki, rozkłady) - bez stron prawnych. Ta sama lista co
// PUBLIC_PAGES w routes/pages.js minus /regulamin i /polityka-prywatnosci,
// liczona bez zależności od express (żeby dało się wołać z ETL/enrich).
function contentPaths() {
  const voivodeships = require('./voivodeships');
  const institutionTypes = require('./institutionTypes');
  const geoPages = require('./geoPages');
  const guides = require('./guides');
  return [
    '/baza',
    ...voivodeships.all().map((v) => `/baza/wojewodztwo/${v.slug}`),
    ...institutionTypes.all().map((t) => `/baza/typ/${t.slug}`),
    ...geoPages.voivodeshipTypes().map((x) => x.path),
    ...geoPages.counties().map((c) => c.path),
    '/faq',
    '/poradniki',
    ...guides.all().map((g) => `/poradniki/${g.slug}`),
  ];
}

// paths: ścieżki ('/baza') albo pełne URL-e. dryRun zwraca body bez wysyłki.
function submit(paths, { dryRun = false } = {}) {
  const root = baseUrl();
  const host = new URL(root).host;
  const urlList = [...new Set(paths)].map((p) => (/^https?:\/\//.test(p) ? p : `${root}${p}`));
  if (!urlList.length) return Promise.resolve({ skipped: 'brak adresów' });

  const body = JSON.stringify({ host, key: KEY, keyLocation: `${root}/${KEY}.txt`, urlList });
  if (dryRun) return Promise.resolve({ dryRun: true, count: urlList.length, host });

  return new Promise((resolve) => {
    const req = https.request(
      ENDPOINT,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data.slice(0, 500), count: urlList.length }));
      }
    );
    req.on('error', (err) => resolve({ error: err.message }));
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

module.exports = { KEY, submit, contentPaths };
