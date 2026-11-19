// Świeża baza dla testów (npm test uruchamia je z DB_PATH=data/test.sqlite):
// sam schemat + syntetyczne instytucje z tests/support/syntheticDb.js. Bez
// kopii prawdziwej bazy - testy dają ten sam wynik lokalnie, w CI i na każdej
// gałęzi, a data/bdik.sqlite nie jest im w ogóle potrzebna.
//
// Migracje (schema + ensureColumn) robimy tu, w jednym procesie: node --test
// odpala pliki testowe równolegle i dwa ALTER TABLE ścigałyby się o kolumnę.
// Nazwa pliku celowo NIE zaczyna się od "test-" - inaczej node --test
// uruchamiałby go drugi raz jako plik testowy, w trakcie innych testów.
const fs = require('fs');
const path = require('path');

const dest = path.join(__dirname, '..', 'data', 'test.sqlite');
for (const suffix of ['', '-wal', '-shm', '.lastmod.json']) fs.rmSync(dest + suffix, { force: true });

process.env.DB_PATH = dest;
const db = require('../db');
const { seedSynthetic } = require('../tests/support/syntheticDb');
const n = seedSynthetic(db);
db.close();
console.log(`Testowa baza gotowa: data/test.sqlite (${n} syntetycznych instytucji)`);
