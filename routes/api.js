const express = require('express');
const db = require('../db');
const { queryInstitutions, iterateInstitutions, coverageCounts, facetValues } = require('../lib/query');
const { isAuthorized, fieldsForRequest } = require('../lib/projection');
const { columnsFor, EXPORT_FIELDS_FULL, EXPORT_FIELDS_PDF } = require('../lib/fieldLabels');
const { streamCsv, streamXlsx, streamPdf } = require('../lib/exportFormats');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Wymagane logowanie.' });
  }
  return next();
}

function parseFilters(query) {
  return {
    voivodeship: query.voivodeship || '',
    county: query.county || '',
    commune: query.commune || '',
    locality: query.locality || '',
    postal_code: query.postal_code || '',
    legal_form: query.legal_form || '',
  };
}

router.get('/institutions', (req, res) => {
  const columns = fieldsForRequest(req);
  const authorized = isAuthorized(req);
  const filters = parseFilters(req.query);
  const search = req.query.q || '';

  const result = queryInstitutions(db, {
    filters,
    search,
    sort: req.query.sort || 'name',
    order: req.query.order || 'asc',
    page: req.query.page,
    pageSize: req.query.pageSize,
    columns,
    isAuthorized: authorized,
  });

  // Agregat (ile telefonów/e-maili/WWW wypełnionych) liczymy dla całego
  // zestawu wyników - to statystyka pokrycia, nie same dane kontaktowe,
  // więc pokazujemy ją także niezalogowanym.
  const coverage = coverageCounts(db, { filters, search });

  res.json({
    rows: result.rows,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    coverage,
    authorized,
  });
});

router.get('/institutions/facets/:level', (req, res) => {
  const level = req.params.level;
  const values = facetValues(db, level, parseFilters(req.query));
  res.json({ level, values });
});

const EXPORT_CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

router.get('/institutions/export', requireAuth, async (req, res) => {
  const format = String(req.query.format || 'csv').toLowerCase();
  if (!EXPORT_CONTENT_TYPES[format]) {
    return res.status(400).json({ error: 'Nieobsługiwany format. Dozwolone: csv, xlsx, pdf.' });
  }

  const fieldKeys = format === 'pdf' ? EXPORT_FIELDS_PDF : EXPORT_FIELDS_FULL;
  const columns = columnsFor(fieldKeys);

  const rowIterator = iterateInstitutions(db, {
    filters: parseFilters(req.query),
    search: req.query.q || '',
    sort: req.query.sort || 'name',
    order: req.query.order || 'asc',
    columns: fieldKeys,
  });

  res.setHeader('Content-Type', EXPORT_CONTENT_TYPES[format]);
  res.setHeader('Content-Disposition', `attachment; filename="instytucje-kultury.${format}"`);

  if (format === 'csv') {
    return streamCsv(res, rowIterator, columns);
  }
  if (format === 'xlsx') {
    return streamXlsx(res, rowIterator, columns);
  }
  return streamPdf(res, rowIterator, columns);
});

module.exports = router;
