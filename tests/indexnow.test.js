const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { KEY, submit, contentPaths } = require('../lib/indexnow');

test('indexnow: plik klucza w public/ istnieje i zawiera dokładnie klucz', () => {
  const file = path.join(__dirname, '..', 'public', `${KEY}.txt`);
  assert.ok(fs.existsSync(file), `brak public/${KEY}.txt`);
  assert.equal(fs.readFileSync(file, 'utf8').trim(), KEY);
});

test('indexnow: contentPaths zwraca strony treściowe bez stron prawnych', () => {
  const paths = contentPaths();
  assert.ok(paths.includes('/baza'));
  assert.ok(paths.includes('/faq'));
  assert.ok(paths.some((p) => p.startsWith('/baza/wojewodztwo/')));
  assert.ok(paths.some((p) => p.startsWith('/poradniki/')));
  assert.ok(!paths.includes('/regulamin'));
  assert.ok(!paths.includes('/polityka-prywatnosci'));
  assert.equal(new Set(paths).size, paths.length, 'adresy nie są unikalne');
});

test('indexnow: submit --dry-run buduje absolutne URL-e i nie wysyła', async () => {
  const res = await submit(['/baza', '/faq'], { dryRun: true });
  assert.equal(res.dryRun, true);
  assert.equal(res.count, 2);
});
