// Generuje przykładowy plik eksportu (po jednej instytucji z każdego województwa)
// pokazywany na /baza w sekcji "Jak to działa". Plik powstaje tym samym kodem co
// eksport płatny, więc struktura kolumn i nota licencyjna są identyczne.
//
// Uruchomienie po aktualizacji bazy: node scripts/build_sample_export.js
//
// Uruchom ponownie także po zmianie danych sprzedawcy w .env - nota licencyjna
// z nazwą sprzedawcy jest wpieczona w plik w momencie generowania.

require('dotenv').config(); // bez tego nota licencyjna bierze domyślnego sprzedawcę z kodu, nie z .env
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { columnsFor, EXPORT_FIELDS_FULL, EXPORT_FIELDS_PDF } = require('../lib/fieldLabels');
const { streamPdf } = require('../lib/exportFormats');

const OUT_PATH = path.join(__dirname, '..', 'public', 'pliki', 'przykladowa-lista-instytucji-kultury.pdf');

// Do próbki bierzemy wyłącznie rekordy kompletne (kontakt + adres + NIP/REGON),
// po jednym na województwo - próbka ma pokazywać maksimum tego, co zawiera baza.
const REQUIRED = ['phone', 'email', 'website', 'street', 'postal_code', 'nip', 'regon'];

function pickRows() {
  const notEmpty = REQUIRED.map((f) => `${f} IS NOT NULL AND ${f} != ''`).join(' AND ');
  return db
    .prepare(
      `SELECT ${EXPORT_FIELDS_FULL.join(', ')} FROM institutions
       WHERE ${notEmpty}
       GROUP BY voivodeship
       ORDER BY voivodeship`
    )
    .all();
}

async function main() {
  const rows = pickRows();
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(OUT_PATH);
    out.on('error', reject);
    out.on('finish', resolve);
    Promise.resolve(streamPdf(out, rows, columnsFor(EXPORT_FIELDS_PDF))).catch(reject);
  });

  console.log(`Zapisano ${rows.length} rekordów do ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
