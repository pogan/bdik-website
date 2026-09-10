#!/usr/bin/env node
// Ręczne zgłoszenie adresów treściowych do IndexNow (Bing/Yandex/Seznam).
// Uruchom po deployu, który dodaje lub zmienia strony, albo po odświeżeniu
// danych. Enrich (scripts/enrich_contacts.js) robi to samo automatycznie,
// gdy w produkcji faktycznie coś zmieni.
//
// Użycie: npm run indexnow [-- --dry-run]
require('dotenv').config();

const { submit, contentPaths, KEY } = require('../lib/indexnow');
const { baseUrl } = require('../lib/seo');

(async () => {
  const dryRun = process.argv.includes('--dry-run');
  const paths = contentPaths();
  console.log(`IndexNow${dryRun ? ' [dry-run]' : ''}: ${paths.length} adresów, host ${baseUrl()}`);
  console.log(`Klucz: ${KEY} (plik musi być pod ${baseUrl()}/${KEY}.txt)`);

  const res = await submit(paths, { dryRun });
  console.log(res);

  // 200 = przyjęte, 202 = przyjęte do weryfikacji klucza, 400 = zły format,
  // 403 = klucz nie pasuje do pliku, 422 = URL-e spoza hosta, 429 = za często.
  if (res.error || (res.status && res.status >= 400)) process.exit(1);
})();
