// Jedyne miejsce decydujące, które pola instytucji widzi dany użytkownik.
// Gating działa na poziomie listy kolumn w SELECT (patrz lib/query.js),
// nie przez odsiewanie pól po pobraniu z bazy - dane płatne nigdy nie
// opuszczają bazy dla niezalogowanego.

const PUBLIC_FIELDS = ['id', 'name', 'voivodeship', 'locality'];

const FULL_FIELDS = [
  'id', 'regon', 'nip', 'name', 'legal_form',
  'voivodeship', 'county', 'commune', 'locality',
  'street', 'building_no', 'unit_no', 'postal_code', 'post_office',
  'phone', 'fax', 'email', 'website',
  'pkd_main_code', 'pkd_main_desc', 'employment_band',
  'activity_start_date', 'founded_date',
];

// Administratorzy: rola 'admin' w bazie ALBO adres z allowlisty ADMIN_EMAILS
// (domyślnie właściciel serwisu). Email w konfiguracji jest zabezpieczeniem na
// wypadek, gdyby konto istniało, ale bez ustawionej roli.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'karol.konop@gmail.com')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isAuthorized(req) {
  return Boolean(req.user && req.user.is_active);
}

function isAdmin(req) {
  if (!req.user || !req.user.is_active) return false;
  return req.user.role === 'admin' || ADMIN_EMAILS.includes((req.user.email || '').toLowerCase());
}

function fieldsForRequest(req) {
  return isAuthorized(req) ? FULL_FIELDS : PUBLIC_FIELDS;
}

module.exports = { PUBLIC_FIELDS, FULL_FIELDS, ADMIN_EMAILS, isAuthorized, isAdmin, fieldsForRequest };
