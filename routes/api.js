const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { queryInstitutions, countWithContact, coverageCounts, facetValues, FILTERABLE_COLUMNS, ADMIN_FILTERABLE_COLUMNS, CONTACT_FILTER_VALUES } = require('../lib/query');
const { priceBreakdown, formatAmount, formatPricePerRow } = require('../lib/pricing');
const { isAdmin, fieldsForRequest } = require('../lib/projection');
const { normalizeSelection, EXPORT_FORMATS } = require('../lib/orders');
const { streamExport } = require('../lib/exportRun');
const { recordEvent, isClientEvent } = require('../lib/visits');
const { isValidEmail, saveLead } = require('../lib/leads');
const { sendLeadSampleSafe } = require('../lib/mailer');

const router = express.Router();

// Eksport dla klientów jest płatny (routes/payments.js -> /pobierz/:token).
// Ta ścieżka zostaje wyłącznie dla administratora - inaczej byłaby darmową
// furtką omijającą płatność.
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: 'Eksport jest płatny. Użyj przycisku pobierania na stronie bazy.' });
  }
  return next();
}

// Zwykły użytkownik filtruje po sześciu kolumnach lokalizacyjnych; administrator
// po każdej kolumnie tabeli. Zestaw kluczy jest tu twardo ograniczony, więc
// dopisanie dowolnego parametru do URL-a nie odblokuje filtra spoza listy.
function parseFilters(query, req) {
  const allowed = req && isAdmin(req) ? ADMIN_FILTERABLE_COLUMNS : FILTERABLE_COLUMNS;
  const filters = {};
  for (const col of allowed) {
    const value = query[col];
    if (typeof value === 'string' && value.trim()) filters[col] = value.trim();
  }
  // Publiczny filtr "tylko z danymi kontaktowymi" - wartości spoza białej listy
  // odpadają już tutaj (buildWhere i tak by je zignorował).
  if (typeof query.contact === 'string' && CONTACT_FILTER_VALUES.includes(query.contact)) {
    filters.contact = query.contact;
  }
  return filters;
}

router.get('/institutions', (req, res) => {
  const columns = fieldsForRequest(req);
  // Pełne dane (kontakt, REGON) widzi tylko administrator - dla wszystkich
  // innych (także zwykłych zalogowanych) komórki pozostają zablurowane.
  const authorized = isAdmin(req);
  const filters = parseFilters(req.query, req);
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

  // Orientacyjna cena eksportu bieżącego zestawu wyników - karta eksportu
  // pokazuje ją na żywo, żeby kwota nie była niespodzianką dopiero w modalu.
  // Płatne są tylko rekordy z kontaktem (jak w /api/checkout, gdzie i tak
  // powstaje jedyna wiążąca wycena).
  const billed = countWithContact(db, { filters, search });
  const bd = priceBreakdown(billed);
  const exportPrice = result.total > 0 && billed > 0
    ? {
        grossLabel: formatAmount(bd.gross),
        perRowLabel: formatPricePerRow(bd.perRow),
        billedCount: billed,
        freeCount: Math.max(result.total - billed, 0),
      }
    : null;

  res.json({
    rows: result.rows,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    coverage,
    exportPrice,
    authorized,
  });
});

const PUBLIC_FACET_LEVELS = ['voivodeship', 'county', 'commune', 'locality'];

router.get('/institutions/facets/:level', (req, res) => {
  const level = req.params.level;
  // Słowniki kolumn administracyjnych (forma prawna, źródło, PKD) są częścią
  // widoku admina - dla pozostałych zostają tylko cztery poziomy hierarchii.
  if (!PUBLIC_FACET_LEVELS.includes(level) && !isAdmin(req)) {
    return res.json({ level, values: [] });
  }
  const values = facetValues(db, level, parseFilters(req.query, req));
  return res.json({ level, values });
});

router.get('/institutions/export', requireAdmin, async (req, res) => {
  const format = String(req.query.format || 'csv').toLowerCase();
  if (!EXPORT_FORMATS.includes(format)) {
    return res.status(400).json({ error: 'Nieobsługiwany format. Dozwolone: csv, xlsx, pdf.' });
  }

  const selection = normalizeSelection({ ...parseFilters(req.query, req), q: req.query.q, sort: req.query.sort, order: req.query.order });

  return streamExport(res, { format, selection, filename: 'instytucje-kultury' });
});

// Zdarzenia lejka zgłaszane z przeglądarki. Nazwa zdarzenia jest w ścieżce,
// więc zgłoszenie nie potrzebuje body ani parsera JSON - wystarczy sendBeacon.
// Przyjmujemy wyłącznie zdarzenia z listy klienckiej (lib/visits.js) - kroków
// serwerowych (wycena, start płatności) nie da się podrobić POST-em.
router.post('/events/:name', (req, res) => {
  // Klikanie po własnym serwisie nie jest zachowaniem klienta - admina nie
  // liczymy (tak samo jak jego odwiedzin, patrz app.js).
  if (isAdmin(req)) return res.status(204).end();
  if (!isClientEvent(req.params.name) || !recordEvent(req.ip, req.params.name)) {
    return res.status(400).json({ error: 'Nieznane zdarzenie.' });
  }
  return res.status(204).end();
});

// Formularz próbki: zapis leada wymaga poprawnego adresu i JAWNEJ zgody
// marketingowej (literalne true, jak przy zgodach zakupowych). Limit chroni
// przed zapychaniem tabeli i masową wysyłką z naszego SMTP.
const leadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zbyt wiele zgłoszeń. Spróbuj ponownie za kilka minut.' },
});

router.post('/leads', leadLimiter, express.json(), (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Podaj poprawny adres e-mail.' });
  }
  if (req.body.consent !== true) {
    return res.status(400).json({ error: 'Aby otrzymać próbkę e-mailem, zaznacz zgodę.' });
  }

  saveLead(email, 'sample');
  sendLeadSampleSafe(email);
  if (!isAdmin(req)) recordEvent(req.ip, 'lead_saved');

  return res.status(204).end();
});

module.exports = router;
