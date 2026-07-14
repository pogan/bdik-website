const express = require('express');
const db = require('../db');
const { queryInstitutions, coverageCounts, facetValues } = require('../lib/query');
const { isAuthorized, fieldsForRequest } = require('../lib/projection');
const { normalizeSelection, EXPORT_FORMATS } = require('../lib/orders');
const { streamExport } = require('../lib/exportRun');

const router = express.Router();

// Eksport dla klientów jest płatny (routes/payments.js -> /pobierz/:token).
// Ta ścieżka zostaje wyłącznie dla administratora - inaczej byłaby darmową
// furtką omijającą płatność.
function requireAdmin(req, res, next) {
  if (!isAuthorized(req) || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Eksport jest płatny. Użyj przycisku pobierania na stronie bazy.' });
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

router.get('/institutions/export', requireAdmin, async (req, res) => {
  const format = String(req.query.format || 'csv').toLowerCase();
  if (!EXPORT_FORMATS.includes(format)) {
    return res.status(400).json({ error: 'Nieobsługiwany format. Dozwolone: csv, xlsx, pdf.' });
  }

  const selection = normalizeSelection({ ...parseFilters(req.query), q: req.query.q, sort: req.query.sort, order: req.query.order });

  return streamExport(res, { format, selection, filename: 'instytucje-kultury' });
});

module.exports = router;
