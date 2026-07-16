const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(__dirname, '..', 'data', 'enrich_report.json');
const FALLBACK = '01.01.2026';

function formatPl(date) {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${date.getUTCFullYear()}`;
}

// Data ostatniej aktualizacji danych = najnowszy znacznik czasu z raportu
// wzbogacania (ETL zapisuje started_at i finished_at). Raport bywa niekompletny
// albo nieobecny (świeży klon, przerwany przebieg), dlatego każdy błąd odczytu
// kończy się datą zapasową zamiast wywrócenia widoku.
function lastDataUpdate(reportPath = REPORT_PATH) {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return FALLBACK;
  }

  const times = [report && report.finished_at, report && report.started_at]
    .map((value) => (typeof value === 'string' ? Date.parse(value) : NaN))
    .filter((ms) => Number.isFinite(ms));

  if (!times.length) return FALLBACK;
  return formatPl(new Date(Math.max(...times)));
}

module.exports = { lastDataUpdate, FALLBACK };
