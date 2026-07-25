const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(__dirname, '..', 'data', 'enrich_report.json');
const FALLBACK = '01.01.2026';
const FALLBACK_DATE = new Date(Date.UTC(2026, 0, 1));

function formatPl(date) {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${date.getUTCFullYear()}`;
}

// Data ostatniej aktualizacji danych (obiekt Date) = najnowszy znacznik czasu
// z raportu wzbogacania (ETL zapisuje started_at i finished_at). Raport bywa
// niekompletny albo nieobecny (świeży klon, przerwany przebieg), dlatego każdy
// błąd odczytu kończy się datą zapasową zamiast wywrócenia widoku. Osobna
// funkcja zwracająca Date (zamiast tylko sformatowanego stringa PL) - potrzebna
// tam, gdzie liczy się porównywalna/ISO data, np. <lastmod> w sitemap.xml.
function lastDataUpdateDate(reportPath = REPORT_PATH) {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return FALLBACK_DATE;
  }

  const times = [report && report.finished_at, report && report.started_at]
    .map((value) => (typeof value === 'string' ? Date.parse(value) : NaN))
    .filter((ms) => Number.isFinite(ms));

  if (!times.length) return FALLBACK_DATE;
  return new Date(Math.max(...times));
}

function lastDataUpdate(reportPath = REPORT_PATH) {
  return formatPl(lastDataUpdateDate(reportPath));
}

module.exports = { lastDataUpdate, lastDataUpdateDate, FALLBACK };
