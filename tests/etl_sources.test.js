const test = require('node:test');
const assert = require('node:assert/strict');

const { selectSources, usesFixtures } = require('../etl/run');
const csvSeed = require('../sources/csv_seed');
const rik = require('../sources/rik');
const gus = require('../sources/gus');
const krs = require('../sources/krs');
const ceidg = require('../sources/ceidg');
const { readFixture } = require('../sources/fixtures');
const { mergeRecord } = require('../etl/dedup');

const ALL = [csvSeed, ceidg, krs, rik, gus];

// Testy grzebią w zmiennych środowiskowych, które czytają moduły źródeł -
// każdy przywraca stan poprzedni, żeby kolejność testów nie miała znaczenia.
// Funkcja jest async, bo przy synchronicznym `return fn()` blok finally
// przywracałby env już w chwili zwrócenia promisy, a więc przed końcem
// asynchronicznego ciała testu.
async function withEnv(vars, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('poza produkcją ETL uruchamia wszystkie źródła (mocki włącznie)', async () => {
  await withEnv({ NODE_ENV: 'development', RIK_LIVE: undefined }, () => {
    const { runnable, skipped } = selectSources(ALL);
    assert.deepEqual(runnable.map((s) => s.name), ['seed', 'ceidg', 'krs', 'rik', 'gus']);
    assert.deepEqual(skipped, []);
  });
});

test('na produkcji ETL pomija źródła oparte na fixture\'ach', async () => {
  await withEnv({ NODE_ENV: 'production', RIK_LIVE: undefined }, () => {
    const { runnable, skipped } = selectSources(ALL);
    assert.deepEqual(runnable.map((s) => s.name), ['seed']);
    assert.deepEqual(skipped.map((s) => s.name), ['ceidg', 'krs', 'rik', 'gus']);
  });
});

test('na produkcji RIK_LIVE=true dopuszcza RIK (czyta żywe API, nie fixture)', async () => {
  await withEnv({ NODE_ENV: 'production', RIK_LIVE: 'true' }, () => {
    const { runnable, skipped } = selectSources(ALL);
    assert.deepEqual(runnable.map((s) => s.name), ['seed', 'rik']);
    assert.deepEqual(skipped.map((s) => s.name), ['ceidg', 'krs', 'gus']);
  });
});

test('seed (realny CSV) nigdy nie jest źródłem fixture\'owym', async () => {
  assert.equal(usesFixtures(csvSeed), false);
  await withEnv({ NODE_ENV: 'production' }, () => {
    assert.equal(usesFixtures(csvSeed), false);
  });
});

test('readFixture odmawia wczytania danych testowych na produkcji', async () => {
  await withEnv({ NODE_ENV: 'production' }, () => {
    assert.throws(() => readFixture('gus.json'), /NODE_ENV=production/);
  });
  await withEnv({ NODE_ENV: 'test' }, () => {
    assert.ok(readFixture('gus.json').length > 0);
  });
});

test('RIK: nazwa i adres wielkimi literami jak w seedzie, bez REGON-u nie zamazuje regon_valid', () => {
  const canonical = rik.toCanonical({
    'Numer wpisu do rejestru': 'RIK 71/2006',
    'Pełna nazwa instytucji kultury': 'Narodowe Centrum Kultury',
    'Siedziba i adres instytucji kultury': 'ul. Płocka 13 01-231 Warszawa ',
  });
  assert.equal(canonical.name, 'NARODOWE CENTRUM KULTURY');
  assert.equal(canonical.name_normalized, 'narodowe centrum kultury');
  assert.equal(canonical.locality, 'WARSZAWA');
  assert.equal(canonical.post_office, 'WARSZAWA');
  assert.equal(canonical.street, 'UL. PŁOCKA');
  assert.equal(canonical.building_no, '13');
  assert.equal(canonical.postal_code, '01-231');

  // Tak RIK trafia do bazy: dopasowany po nazwie i adresie do rekordu z seedu.
  const existing = { regon: '140468418', regon_valid: 1, locality: 'WARSZAWA', __source: 'seed' };
  const merged = mergeRecord(existing, canonical, 'rik');
  assert.equal(merged.regon_valid, 1);
  assert.equal(merged.locality, 'WARSZAWA');
  assert.equal(merged.__source, 'rik');
});

test('fetch źródła-mocka rzuca na produkcji, nawet z pominięciem filtru w ETL', async () => {
  await withEnv({ NODE_ENV: 'production' }, async () => {
    for (const source of [gus, krs, ceidg]) {
      await assert.rejects(async () => {
        // eslint-disable-next-line no-unused-vars
        for await (const _ of source.fetch()) break;
      }, /NODE_ENV=production/, `${source.name} powinno odmówić wczytania fixture'a`);
    }
  });
});
