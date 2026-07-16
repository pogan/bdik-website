require('dotenv').config();
const db = require('../db');
const { hashPayload } = require('../lib/hash');
const { dedupKey, mergeRecord } = require('./dedup');

const csvSeed = require('../sources/csv_seed');
const rik = require('../sources/rik');
const gus = require('../sources/gus');
const krs = require('../sources/krs');
const ceidg = require('../sources/ceidg');

const RAW_TABLES = { seed: 'raw_seed', rik: 'raw_rik', gus: 'raw_gus', krs: 'raw_krs', ceidg: 'raw_ceidg' };

const INSTITUTION_COLUMNS = [
  'regon', 'regon_valid', 'primary_source', 'nip', 'source_ref', 'krs',
  'name', 'name_normalized', 'legal_form',
  'voivodeship', 'county', 'commune', 'locality',
  'street', 'building_no', 'unit_no', 'postal_code', 'post_office',
  'phone', 'fax', 'email', 'website',
  'pkd_main_code', 'pkd_main_desc', 'employment_band',
  'activity_start_date', 'founded_date',
];

const findByRegon = db.prepare('SELECT * FROM institutions WHERE regon = ?');
const isOptedOut = db.prepare('SELECT 1 FROM institution_optouts WHERE regon = ?');
const findByFallback = db.prepare(
  'SELECT * FROM institutions WHERE name_normalized = ? AND postal_code = ? AND building_no = ?'
);

const insertInstitution = db.prepare(`
  INSERT INTO institutions (${INSTITUTION_COLUMNS.join(', ')})
  VALUES (${INSTITUTION_COLUMNS.map((c) => '@' + c).join(', ')})
`);

const updateInstitution = db.prepare(`
  UPDATE institutions SET
    ${INSTITUTION_COLUMNS.map((c) => `${c} = @${c}`).join(', ')},
    updated_at = datetime('now')
  WHERE id = @id
`);

const upsertSourceLink = db.prepare(`
  INSERT INTO institution_sources (institution_id, source, raw_id, first_seen, last_seen)
  VALUES (@institution_id, @source, @raw_id, datetime('now'), datetime('now'))
  ON CONFLICT(institution_id, source) DO UPDATE SET last_seen = datetime('now'), raw_id = @raw_id
`);

function makeInsertRaw(table) {
  return db.prepare(`
    INSERT INTO ${table} (source_ref, fetched_at, payload, payload_hash)
    VALUES (@source_ref, datetime('now'), @payload, @payload_hash)
  `);
}

// Uruchamia pojedyncze źródło: zapis do raw_<source>, transformacja do
// kanonicznego kształtu, i scalenie do institutions wg priorytetu źródeł
// (etl/dedup.js) - pole nadpisywane tylko gdy puste albo źródło ma wyższy
// priorytet, więc mock o niższym priorytecie nie zamazuje lepszych danych.
async function runSource(source) {
  const rawTable = RAW_TABLES[source.name];
  const insertRaw = makeInsertRaw(rawTable);

  let inserted = 0;
  let updated = 0;
  let skippedNoKey = 0;
  let skippedNoRegon = 0;
  let skippedOptout = 0;

  const transaction = db.transaction((raw) => {
    const canonical = source.toCanonical(raw);
    // Instytucja zgłoszona do usunięcia (RODO opt-out) nie wraca do bazy przy
    // kolejnym przebiegu ETL - pomijamy ją zanim zapiszemy cokolwiek (także raw).
    if (canonical.regon && isOptedOut.get(canonical.regon)) {
      skippedOptout += 1;
      return;
    }
    const rawResult = insertRaw.run({
      source_ref: canonical.source_ref || '',
      payload: JSON.stringify(raw),
      payload_hash: hashPayload(raw),
    });
    const rawId = rawResult.lastInsertRowid;

    const key = dedupKey(canonical);
    if (!key) {
      skippedNoKey += 1;
      return;
    }

    let existing;
    if (canonical.regon) {
      existing = findByRegon.get(canonical.regon);
    } else {
      const [, name, postal, building] = key.match(/^fallback:(.*)\|(.*)\|(.*)$/) || [];
      existing = findByFallback.get(name, postal, building);
    }

    let institutionId;
    if (existing) {
      const merged = mergeRecord({ ...existing, __source: existing.primary_source }, canonical, source.name);
      updateInstitution.run({
        ...Object.fromEntries(INSTITUTION_COLUMNS.map((c) => [c, merged[c]])),
        primary_source: merged.__source,
        id: existing.id,
      });
      institutionId = existing.id;
      updated += 1;
    } else if (!canonical.regon) {
      // institutions.regon to NOT NULL UNIQUE - REGON jest kluczem naturalnym
      // encji, więc bez niego nowego wiersza założyć się nie da (drugi pusty
      // REGON zerwałby UNIQUE). Źródło bez REGON-u (RIK) może tylko wzbogacać
      // instytucje dopasowane po nazwie i adresie; niedopasowanych nie zakłada.
      skippedNoRegon += 1;
      return;
    } else {
      const result = insertInstitution.run({ ...canonical, primary_source: source.name });
      institutionId = result.lastInsertRowid;
      inserted += 1;
    }

    upsertSourceLink.run({ institution_id: institutionId, source: source.name, raw_id: rawId });
  });

  for await (const raw of source.fetch()) {
    transaction(raw);
  }

  return { source: source.name, inserted, updated, skippedNoKey, skippedNoRegon, skippedOptout };
}

// Czy dane tego źródła pochodzą z fixture'a (danych testowych). Źródła-mocki
// deklarują to na stałe (fixtureOnly), RIK zależnie od RIK_LIVE.
function usesFixtures(source) {
  if (typeof source.usesFixtures === 'function') return source.usesFixtures();
  return Boolean(source.fixtureOnly);
}

// Na produkcji do bazy wpuszczamy wyłącznie źródła z realnymi danymi. Fixture'y
// (example-fixture-*.pl, wymyślone REGON-y) trafiłyby inaczej do eksportu, za
// który klient płaci. Poza produkcją zachowanie się nie zmienia - mocki są tam
// jedynym sposobem, żeby przećwiczyć ścieżkę scalania wielu źródeł.
function selectSources(sources) {
  if (process.env.NODE_ENV !== 'production') return { runnable: sources, skipped: [] };
  const runnable = sources.filter((s) => !usesFixtures(s));
  return { runnable, skipped: sources.filter((s) => usesFixtures(s)) };
}

async function main() {
  // Kolejność nie ma znaczenia dla poprawności (mergeRecord respektuje
  // priorytet niezależnie od kolejności przebiegu), ale seed jako jedyne
  // realne źródło idzie pierwsze, żeby log czytał się w naturalnej kolejności.
  const { runnable, skipped } = selectSources([csvSeed, ceidg, krs, rik, gus]);

  for (const source of skipped) {
    const hint = source.name === 'rik' ? ' (ustaw RIK_LIVE=true, żeby czytać żywe API)' : '';
    console.log(`ETL pomija: ${source.name} - dane testowe (fixture), a NODE_ENV=production${hint}`);
  }

  for (const source of runnable) {
    console.log(`ETL start: ${source.name}`);
    const stats = await runSource(source);
    console.log('ETL zakończony:', stats);
  }

  const total = db.prepare('SELECT COUNT(*) AS c FROM institutions').get().c;
  const validRegon = db.prepare('SELECT COUNT(*) AS c FROM institutions WHERE regon_valid = 1').get().c;
  const distinctRegon = db.prepare('SELECT COUNT(DISTINCT regon) AS c FROM institutions').get().c;
  console.log(`Razem instytucji: ${total}, poprawny REGON: ${validRegon}, unikalnych REGON: ${distinctRegon}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runSource, main, selectSources, usesFixtures };
