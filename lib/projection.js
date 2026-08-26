// Jedyne miejsce decydujące, które pola instytucji widzi dany użytkownik.
// Gating działa na poziomie listy kolumn w SELECT (patrz lib/query.js),
// nie przez odsiewanie pól po pobraniu z bazy - dane płatne nigdy nie
// opuszczają bazy dla nie-administratora. Pełne dane (kontakt, REGON/NIP)
// widzi WYŁĄCZNIE administrator; zwykły zalogowany użytkownik dostaje
// dokładnie to samo co anonim.

// Pola darmowe: lokalizacja + adres pocztowy (powiat, ulica, kod). Dane
// kontaktowe (telefon/e-mail/WWW) i identyfikatory (REGON/NIP) zostają płatne.
const PUBLIC_FIELDS = [
  'id', 'name', 'voivodeship', 'county', 'locality',
  'street', 'building_no', 'unit_no', 'postal_code',
];

// Komplet kolumn tabeli institutions - widok administratora pokazuje wszystko,
// łącznie z polami technicznymi (źródło, znaczniki czasu, pola znormalizowane),
// których nie ma w eksporcie dla klienta.
const ADMIN_FIELDS = [
  'id', 'regon', 'regon_valid', 'primary_source', 'nip', 'source_ref', 'krs',
  'name', 'name_normalized', 'legal_form',
  'voivodeship', 'county', 'commune', 'locality',
  'street', 'building_no', 'unit_no', 'postal_code', 'post_office',
  'phone', 'phone_normalized', 'fax', 'email', 'website',
  'pkd_main_code', 'pkd_main_desc', 'employment_band',
  'activity_start_date', 'founded_date', 'created_at', 'updated_at',
];

// Administratorzy: rola 'admin' w bazie ALBO adres z allowlisty ADMIN_EMAILS
// (domyślnie właściciel serwisu). Email w konfiguracji jest zabezpieczeniem na
// wypadek, gdyby konto istniało, ale bez ustawionej roli.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
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
  return isAdmin(req) ? ADMIN_FIELDS : PUBLIC_FIELDS;
}

module.exports = { PUBLIC_FIELDS, ADMIN_FIELDS, ADMIN_EMAILS, isAuthorized, isAdmin, fieldsForRequest };
