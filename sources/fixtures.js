// Jedyne wejście do katalogu __fixtures__. Fixture'y to dane TESTOWE (adresy
// example-fixture-*.pl, wymyślone REGON-y) - na produkcji nie mogą trafić do
// bazy, bo klient zapłaciłby za nieistniejące instytucje.
//
// ETL odsiewa źródła fixture'owe zanim w ogóle sięgnie po dane (etl/run.js), a
// ten rzut jest zabezpieczeniem na wypadek, gdyby jakaś inna ścieżka (skrypt,
// nowe źródło) spróbowała wczytać fixture na produkcji mimo to.
const fs = require('fs');
const path = require('path');

const FIXTURES_DIR = path.join(__dirname, '__fixtures__');

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function readFixture(file) {
  if (isProduction()) {
    throw new Error(
      `Odmowa wczytania fixture'a "${file}" przy NODE_ENV=production - to dane testowe. ` +
        'Źródła oparte na fixture\'ach są na produkcji pomijane; jeśli widzisz ten błąd, ' +
        'jakaś ścieżka omija filtr w etl/run.js.'
    );
  }
  return fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8');
}

function readJsonFixture(file) {
  return JSON.parse(readFixture(file));
}

module.exports = { readFixture, readJsonFixture, isProduction, FIXTURES_DIR };
