// Realizacja żądania usunięcia instytucji z bazy (RODO, art. 17/21).
// Użycie: node scripts/optout_institution.js <REGON> [powód]
//
// Dodaje REGON do institution_optouts (żeby kolejny przebieg ETL go nie
// przywrócił) i usuwa istniejący rekord z institutions. Zapytania i eksport i tak
// pomijają REGON-y z listy opt-out - patrz lib/query.js.
require('dotenv').config();
const db = require('../db');

const regon = (process.argv[2] || '').trim();
const reason = (process.argv[3] || '').trim() || null;

if (!/^\d{9}(\d{5})?$/.test(regon)) {
  console.error('Użycie: node scripts/optout_institution.js <REGON> [powód]');
  console.error('REGON musi mieć 9 albo 14 cyfr.');
  process.exit(1);
}

const tx = db.transaction(() => {
  db.prepare(
    `INSERT INTO institution_optouts (regon, reason) VALUES (?, ?)
     ON CONFLICT(regon) DO UPDATE SET reason = COALESCE(excluded.reason, institution_optouts.reason)`,
  ).run(regon, reason);
  const del = db.prepare('DELETE FROM institutions WHERE regon = ?').run(regon);
  return del.changes;
});

const removed = tx();
console.log(
  `Opt-out zapisany dla REGON ${regon}` +
    (removed ? ` (usunięto ${removed} rekord z bazy).` : ' (brak rekordu w bazie - nie wróci przy ETL).'),
);
