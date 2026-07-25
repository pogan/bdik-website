const { TYPE_CONDITIONS, TYPE_FILTER_VALUES } = require('./institutionTypes');

const FILTERABLE_COLUMNS = ['voivodeship', 'county', 'commune', 'locality', 'postal_code', 'legal_form'];

// Filtry dostępne wyłącznie w widoku administratora (routes/api.js decyduje,
// które klucze w ogóle trafią do filters). Kolumny słownikowe dopasowujemy
// dokładnie, resztę fragmentem - szukanie po pełnym numerze telefonu czy
// całym adresie WWW byłoby bezużyteczne.
const ADMIN_EXACT_COLUMNS = ['primary_source', 'regon_valid', 'pkd_main_code', 'employment_band'];
const ADMIN_LIKE_COLUMNS = [
  'name', 'regon', 'nip', 'krs', 'source_ref',
  'street', 'building_no', 'unit_no', 'post_office',
  'phone', 'fax', 'email', 'website',
  'pkd_main_desc', 'activity_start_date', 'founded_date', 'created_at', 'updated_at',
];
const ADMIN_FILTERABLE_COLUMNS = [...FILTERABLE_COLUMNS, ...ADMIN_EXACT_COLUMNS, ...ADMIN_LIKE_COLUMNS];

const EXACT_COLUMNS = new Set([...FILTERABLE_COLUMNS, ...ADMIN_EXACT_COLUMNS]);

// Filtr "tylko z danymi kontaktowymi". Klucz filtra to 'contact', wartości
// z tej mapy - wartość NIGDY nie trafia do SQL jako tekst (tylko wybiera
// gotowy warunek), więc nie ma czego wstrzykiwać. Ten sam warunek 'any'
// wyznacza rekordy PŁATNE przy wycenie (countWithContact) - płaci się
// wyłącznie za rekordy, które mają jakikolwiek kanał kontaktu.
const filled = (col) => `(${col} IS NOT NULL AND TRIM(${col}) <> '')`;
const CONTACT_CONDITIONS = {
  any: `(${filled('phone')} OR ${filled('email')} OR ${filled('website')})`,
  phone: filled('phone'),
  email: filled('email'),
  website: filled('website'),
};
const CONTACT_FILTER_VALUES = Object.keys(CONTACT_CONDITIONS);

const SORTABLE_COLUMNS = [
  'name', 'regon', 'nip', 'krs', 'legal_form', 'primary_source', 'regon_valid', 'source_ref',
  'voivodeship', 'county', 'commune', 'locality',
  'street', 'building_no', 'unit_no', 'postal_code', 'post_office',
  'phone', 'fax', 'email', 'website',
  'pkd_main_code', 'pkd_main_desc', 'employment_band',
  'activity_start_date', 'founded_date', 'created_at', 'updated_at',
];
const COVERAGE_COLUMNS = ['phone', 'email', 'website'];

// Znaki wieloznaczne LIKE w tym, co wpisał użytkownik, tracą specjalne
// znaczenie - inaczej "%" w polu filtra dopasowałby wszystko.
function likePattern(value) {
  return `%${String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

const PUBLIC_MAX_PAGE_SIZE = 50;
const FULL_MAX_PAGE_SIZE = 500;

// Usuwa znaki specjalne FTS5 (cudzysłowy, gwiazdki) i dodaje prefix-match ('*')
// do każdego tokenu, żeby wpisany fragment słowa trafiał wyniki.
function sanitizeFtsQuery(raw) {
  return raw
    .normalize('NFC')
    .replace(/["*]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => `${tok}*`)
    .join(' ');
}

// Buduje WHERE + parametry współdzielone przez widok tabeli i eksport -
// to jedyne miejsce definiujące filtry, więc nie mogą się rozjechać.
function buildWhere(filters = {}, search = '') {
  // Instytucje zgłoszone do usunięcia (RODO opt-out) wykluczamy wszędzie: podgląd,
  // wycena (countInstitutions) i eksport używają tego samego WHERE, więc rekord
  // znika spójnie ze wszystkich ścieżek, a klient nie zapłaci za usunięty wpis.
  const whereParts = ['regon NOT IN (SELECT regon FROM institution_optouts)'];
  const params = {};

  for (const col of ADMIN_FILTERABLE_COLUMNS) {
    if (!filters[col]) continue;
    if (EXACT_COLUMNS.has(col)) {
      whereParts.push(`${col} = @${col}`);
      params[col] = filters[col];
    } else {
      whereParts.push(`${col} LIKE @${col} ESCAPE '\\'`);
      params[col] = likePattern(filters[col]);
    }
  }

  // Filtr kontaktu działa we wszystkich ścieżkach (tabela, wycena, eksport),
  // bo przechodzi przez to samo WHERE. Nieznana wartość jest ignorowana.
  if (filters.contact && CONTACT_CONDITIONS[filters.contact]) {
    whereParts.push(CONTACT_CONDITIONS[filters.contact]);
  }

  // Filtr typu instytucji (dom/centrum/ośrodek kultury, biblioteka) - ten sam
  // wzorzec co filtr kontaktu, warunek z lib/institutionTypes.js (dopasowanie
  // po nazwie, patrz komentarz tamże). Używany przez strony /baza/typ/:slug
  // i selektor "Typ instytucji" w narzędziu.
  if (filters.type && TYPE_CONDITIONS[filters.type]) {
    whereParts.push(TYPE_CONDITIONS[filters.type]);
  }

  const ftsQuery = search ? sanitizeFtsQuery(search) : '';
  if (ftsQuery) {
    whereParts.push('id IN (SELECT rowid FROM institutions_fts WHERE institutions_fts MATCH @ftsQuery)');
    params.ftsQuery = ftsQuery;
  }

  const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  return { whereClause, params };
}

function resolveSort(sort, order) {
  const sortCol = SORTABLE_COLUMNS.includes(sort) ? sort : 'name';
  const sortOrder = order === 'desc' ? 'DESC' : 'ASC';
  return { sortCol, sortOrder };
}

function queryInstitutions(db, { filters = {}, search = '', sort = 'name', order = 'asc', page = 1, pageSize = 25, columns, isAuthorized = false }) {
  const { whereClause, params } = buildWhere(filters, search);
  const { sortCol, sortOrder } = resolveSort(sort, order);

  const maxPageSize = isAuthorized ? FULL_MAX_PAGE_SIZE : PUBLIC_MAX_PAGE_SIZE;
  const safePageSize = Math.min(Math.max(parseInt(pageSize, 10) || 25, 1), maxPageSize);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (safePage - 1) * safePageSize;

  const selectCols = columns.join(', ');

  const rows = db
    .prepare(
      `SELECT ${selectCols} FROM institutions
       ${whereClause}
       ORDER BY ${sortCol} ${sortOrder}
       LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: safePageSize, offset });

  const total = db.prepare(`SELECT COUNT(*) AS c FROM institutions ${whereClause}`).get(params).c;

  return { rows, total, page: safePage, pageSize: safePageSize };
}

// Iterator strumieniowy (bez limitu/offsetu) dla eksportu - te same filtry
// i sortowanie co queryInstitutions, ale bez wczytywania całości do pamięci.
function iterateInstitutions(db, { filters = {}, search = '', sort = 'name', order = 'asc', columns }) {
  const { whereClause, params } = buildWhere(filters, search);
  const { sortCol, sortOrder } = resolveSort(sort, order);
  const selectCols = columns.join(', ');

  return db
    .prepare(`SELECT ${selectCols} FROM institutions ${whereClause} ORDER BY ${sortCol} ${sortOrder}`)
    .iterate(params);
}

// Sama liczba rekordów w zestawie wyników - bez pobierania wierszy. Na tym
// opiera się wycena eksportu (lib/pricing.js), więc musi używać dokładnie tego
// samego WHERE co iterateInstitutions, inaczej klient zapłaciłby za inny zakres,
// niż dostanie w pliku.
function countInstitutions(db, { filters = {}, search = '' } = {}) {
  const { whereClause, params } = buildWhere(filters, search);
  return db.prepare(`SELECT COUNT(*) AS c FROM institutions ${whereClause}`).get(params).c;
}

// Liczba rekordów PŁATNYCH w zestawie wyników: takich, które mają telefon,
// e-mail lub WWW. Na tym opiera się wycena (routes/payments.js) - rekordy bez
// żadnego kanału kontaktu trafiają do pliku gratis. Ten sam buildWhere co
// eksport, więc zakres płatny zawsze jest podzbiorem zawartości pliku.
function countWithContact(db, { filters = {}, search = '' } = {}) {
  const { whereClause, params } = buildWhere(filters, search);
  const glue = whereClause ? `${whereClause} AND` : 'WHERE';
  return db
    .prepare(`SELECT COUNT(*) AS c FROM institutions ${glue} ${CONTACT_CONDITIONS.any}`)
    .get(params).c;
}

// Ile rekordów w całym zestawie wyników (nie tylko na bieżącej stronie) ma
// wypełniony telefon/e-mail/WWW. Te same filtry co queryInstitutions, więc
// licznik w nagłówku tabeli zgadza się z tym, co widać po eksporcie.
function coverageCounts(db, { filters = {}, search = '', columns = COVERAGE_COLUMNS } = {}) {
  const cols = columns.filter((c) => COVERAGE_COLUMNS.includes(c));
  if (!cols.length) return { total: 0, fields: {} };

  const { whereClause, params } = buildWhere(filters, search);
  const selects = cols
    .map((c) => `SUM(CASE WHEN ${c} IS NOT NULL AND TRIM(${c}) <> '' THEN 1 ELSE 0 END) AS ${c}`)
    .join(', ');

  const row = db.prepare(`SELECT COUNT(*) AS total, ${selects} FROM institutions ${whereClause}`).get(params);
  const total = row.total || 0;

  const fields = {};
  for (const c of cols) {
    const filled = row[c] || 0;
    fields[c] = { filled, empty: total - filled };
  }
  return { total, fields };
}

// Kolumny słownikowe, dla których administrator dostaje listę istniejących
// wartości zamiast pustego pola tekstowego (filtr jest tu dopasowaniem dokładnym,
// więc wpisywanie wartości z palca kończyłoby się pudłami).
const ADMIN_FACET_COLUMNS = ['legal_form', 'primary_source', 'regon_valid', 'employment_band', 'pkd_main_code'];

// Wartości do selektów: dla hierarchii kolejny poziom zawężony przez poprzednie,
// dla kolumn słownikowych - pełna lista wartości występujących w bazie.
function facetValues(db, level, filters = {}) {
  const HIERARCHY = ['voivodeship', 'county', 'commune', 'locality'];
  const idx = HIERARCHY.indexOf(level);
  if (idx === -1 && !ADMIN_FACET_COLUMNS.includes(level)) return [];

  const whereParts = [];
  const params = {};
  const narrowBy = idx === -1 ? HIERARCHY : HIERARCHY.slice(0, idx);
  for (const col of narrowBy) {
    if (filters[col]) {
      whereParts.push(`${col} = @${col}`);
      params[col] = filters[col];
    }
  }
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  return db
    .prepare(`SELECT DISTINCT ${level} AS value FROM institutions ${whereClause} ORDER BY ${level}`)
    .all(params)
    .map((r) => r.value)
    // regon_valid = 0 jest poprawną wartością filtra, więc odsiewamy tylko
    // puste komórki, a nie wszystko, co jest "falsy".
    .filter((v) => v !== null && v !== '')
    .map(String);
}

module.exports = {
  queryInstitutions,
  iterateInstitutions,
  countInstitutions,
  countWithContact,
  coverageCounts,
  CONTACT_FILTER_VALUES,
  facetValues,
  sanitizeFtsQuery,
  FILTERABLE_COLUMNS,
  ADMIN_FILTERABLE_COLUMNS,
  ADMIN_EXACT_COLUMNS,
  ADMIN_LIKE_COLUMNS,
  ADMIN_FACET_COLUMNS,
  SORTABLE_COLUMNS,
  COVERAGE_COLUMNS,
  PUBLIC_MAX_PAGE_SIZE,
  FULL_MAX_PAGE_SIZE,
};
