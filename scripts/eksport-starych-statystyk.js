#!/usr/bin/env node
// Eksport starych statystyk do plików do wglądu (widok /admin/stats usunięty
// 2026-11-18, zastąpiony panelem vamude-kit /kierownik/stats).
//
//   node scripts/eksport-starych-statystyk.js [katalog]
//
// Domyślny katalog: data/archiwum/statystyki-RRRR-MM-DD (data/ jest poza gitem
// i w kopiach restic). Zapisuje:
//   stary-licznik.csv  - tabela visits (licznik sprzed vamude-kit, z ruchem botów),
//                        bez skrótu IP: data pierwszej i ostatniej wizyty, źródło, strona wejścia
//   podsumowanie.json  - to, co pokazywał widok: archiwum licznika (źródła), lejek od startu
//                        statystyk vamude-kit, rozkład widzianych wycen, ostatnie 30 dni, przychód
//   zdarzenia.csv      - liczba osób i wystąpień każdego zdarzenia lejka (od początku)
//
// Tylko odczyt bazy: nic nie kasuje. Tabelę visits usuwamy osobno, po decyzji Karola.
const fs = require('node:fs');
const path = require('node:path');

const db = require('../db');
const stats = require('../lib/stats');
const { EVENTS } = require('../lib/visits');

const today = new Date().toISOString().slice(0, 10);
const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'archiwum', `statystyki-${today}`));

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows, columns) {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
}

fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });

const visitColumns = ['first_seen', 'last_seen', 'landing_path', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign'];
const visits = db.prepare(`SELECT ${visitColumns.join(', ')} FROM visits ORDER BY first_seen`).all();
fs.writeFileSync(path.join(outDir, 'stary-licznik.csv'), toCsv(visits, visitColumns));

const eventRows = db
  .prepare('SELECT name, COUNT(*) AS osoby, SUM(hits) AS wystapienia, MIN(first_seen) AS od, MAX(last_seen) AS do FROM events GROUP BY name')
  .all()
  .map((r) => ({ ...r, etykieta: EVENTS[r.name] || r.name }));
fs.writeFileSync(path.join(outDir, 'zdarzenia.csv'), toCsv(eventRows, ['name', 'etykieta', 'osoby', 'wystapienia', 'od', 'do']));

const summary = {
  wygenerowano: new Date().toISOString(),
  opis: 'Zawartość dawnego widoku /admin/stats bdik.pl (lejek, wyceny, archiwum starego licznika).',
  archiwumStaregoLicznika: stats.archive(),
  lejekOd: stats.funnelSince(),
  lejek: stats.funnel(),
  wyceny: stats.quoteBuckets(),
  ostatnie30Dni: stats.daily(),
  przychodNetto: stats.revenue().netLabel,
};
fs.writeFileSync(path.join(outDir, 'podsumowanie.json'), `${JSON.stringify(summary, null, 2)}\n`);

console.log(`Zapisano w ${outDir}:`);
console.log(`  stary-licznik.csv  ${visits.length} wierszy`);
console.log(`  zdarzenia.csv      ${eventRows.length} zdarzeń`);
console.log('  podsumowanie.json');
