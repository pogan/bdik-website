const db = require('../db');
const { iterateInstitutions } = require('./query');
const { columnsFor, EXPORT_FIELDS_FULL, EXPORT_FIELDS_PDF } = require('./fieldLabels');
const { streamCsv, streamXlsx, streamPdf } = require('./exportFormats');

const EXPORT_CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

// Jedyne miejsce generujące plik eksportu - używa go zarówno pobranie po
// opłaceniu (routes/payments.js), jak i eksport administracyjny (routes/api.js).
function streamExport(res, { format, selection, filename }) {
  const fieldKeys = format === 'pdf' ? EXPORT_FIELDS_PDF : EXPORT_FIELDS_FULL;
  const columns = columnsFor(fieldKeys);

  const rowIterator = iterateInstitutions(db, {
    filters: selection.filters,
    search: selection.q,
    sort: selection.sort,
    order: selection.order,
    columns: fieldKeys,
  });

  res.setHeader('Content-Type', EXPORT_CONTENT_TYPES[format]);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.${format}"`);

  if (format === 'csv') return streamCsv(res, rowIterator, columns);
  if (format === 'xlsx') return streamXlsx(res, rowIterator, columns);
  return streamPdf(res, rowIterator, columns);
}

module.exports = { streamExport, EXPORT_CONTENT_TYPES };
