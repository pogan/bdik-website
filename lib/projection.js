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

function isAuthorized(req) {
  return Boolean(req.user && req.user.is_active);
}

function fieldsForRequest(req) {
  return isAuthorized(req) ? FULL_FIELDS : PUBLIC_FIELDS;
}

module.exports = { PUBLIC_FIELDS, FULL_FIELDS, isAuthorized, fieldsForRequest };
