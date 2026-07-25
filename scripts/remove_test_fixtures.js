// Jednorazowe usunięcie rekordów testowych/dev, które trafiły do bazy
// produkcyjnej (np. przy ręcznym testowaniu ETL) i psują publiczne statystyki
// (hero "2 200+", liczniki per województwo) oraz mogłyby trafić do nowych,
// indeksowalnych stron per województwo/typ jako fikcyjne instytucje.
// Użycie: node scripts/remove_test_fixtures.js
// (uruchom najpierw z DB_PATH=data/test.sqlite, zweryfikuj, potem bez DB_PATH)
require('dotenv').config();
const db = require('../db');

// Wzorzec 'TEST%'/'%TESTOW%'/powiat PRZYKŁADOWY/WZORCOWY łapie większość, ale
// cały fikstur ma wspólny, sekwencyjny (niereal­ny) prefiks REGON '100000xxx'
// (potwierdzone: id 2230-2235, regony 100000043-100000095) - to pewniejszy
// wspólny mianownik niż dopasowanie po nazwie (np. "PRACOWNIA ARTYSTYCZNA
// ANNA NOWAK" nie zawiera słowa "test", ale ma regon z tej samej puli).
const rows = db
  .prepare(
    `SELECT id, name, county, regon FROM institutions
     WHERE name LIKE 'TEST%' OR name LIKE '%TESTOW%'
        OR county IN ('PRZYKŁADOWY', 'WZORCOWY')
        OR regon LIKE '100000%'`
  )
  .all();

if (!rows.length) {
  console.log('Brak rekordów testowych do usunięcia.');
  process.exit(0);
}

console.log(`Znaleziono ${rows.length} rekord(ów) testowych:`);
for (const r of rows) {
  console.log(`  #${r.id} ${r.name} (powiat: ${r.county || '—'}, regon: ${r.regon})`);
}

const del = db.prepare('DELETE FROM institutions WHERE id IN (' + rows.map(() => '?').join(',') + ')');
const result = del.run(...rows.map((r) => r.id));

console.log(`Usunięto ${result.changes} rekord(ów).`);
