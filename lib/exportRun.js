const fs = require('fs');
const db = require('../db');
const { iterateInstitutions } = require('./query');
const { columnsFor, EXPORT_FIELDS_FULL, EXPORT_FIELDS_PDF } = require('./fieldLabels');
const { streamCsv, streamXlsx, streamPdf } = require('./exportFormats');

const EXPORT_CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

// Rdzeń generowania: zapisuje eksport do dowolnego strumienia zapisu (odpowiedź
// HTTP albo plik na dysku). Nie ustawia nagłówków - to robi wrapper HTTP niżej.
function runExport(out, { format, selection }) {
  const fieldKeys = format === 'pdf' ? EXPORT_FIELDS_PDF : EXPORT_FIELDS_FULL;
  const columns = columnsFor(fieldKeys);

  const rowIterator = iterateInstitutions(db, {
    filters: selection.filters,
    search: selection.q,
    sort: selection.sort,
    order: selection.order,
    columns: fieldKeys,
  });

  if (format === 'csv') return streamCsv(out, rowIterator, columns);
  if (format === 'xlsx') return streamXlsx(out, rowIterator, columns);
  return streamPdf(out, rowIterator, columns);
}

// Eksport wprost do odpowiedzi HTTP - pobranie po opłaceniu (routes/payments.js)
// i eksport administracyjny (routes/api.js).
function streamExport(res, { format, selection, filename }) {
  res.setHeader('Content-Type', EXPORT_CONTENT_TYPES[format]);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.${format}"`);
  return runExport(res, { format, selection });
}

// Eksport do pliku na dysku (kopia zapasowa - lib/backup.js). Piszemy do pliku
// tymczasowego i podmieniamy atomowo, żeby równoległe pobranie nigdy nie trafiło
// na plik zapisany do połowy. Promise rozwiązuje się dopiero po domknięciu pliku.
function writeExportToFile(filePath, { format, selection }) {
  return new Promise((resolve, reject) => {
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const out = fs.createWriteStream(tmpPath);
    out.on('error', reject);
    out.on('finish', () => {
      try {
        fs.renameSync(tmpPath, filePath);
        resolve(filePath);
      } catch (err) {
        reject(err);
      }
    });
    // streamXlsx zwraca Promise (błąd generowania), streamCsv/streamPdf kończą
    // strumień synchronicznie - w obu wypadkach 'finish' domyka całość.
    Promise.resolve(runExport(out, { format, selection })).catch((err) => {
      out.destroy();
      fs.rm(tmpPath, { force: true }, () => reject(err));
    });
  });
}

module.exports = { streamExport, writeExportToFile, EXPORT_CONTENT_TYPES };
