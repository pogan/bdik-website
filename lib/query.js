const FILTERABLE_COLUMNS = ['voivodeship', 'county', 'commune', 'locality', 'postal_code', 'legal_form'];
const SORTABLE_COLUMNS = ['name', 'voivodeship', 'county', 'commune', 'locality', 'postal_code', 'created_at'];
const COVERAGE_COLUMNS = ['phone', 'email', 'website'];

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
  const whereParts = [];
  const params = {};

  for (const col of FILTERABLE_COLUMNS) {
    if (filters[col]) {
      whereParts.push(`${col} = @${col}`);
      params[col] = filters[col];
    }
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

// Wartości do kaskadowych selectów: kolejny poziom zawężony przez poprzednie.
function facetValues(db, level, filters = {}) {
  const HIERARCHY = ['voivodeship', 'county', 'commune', 'locality'];
  const idx = HIERARCHY.indexOf(level);
  if (idx === -1) return [];

  const whereParts = [];
  const params = {};
  for (const col of HIERARCHY.slice(0, idx)) {
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
    .filter(Boolean);
}

module.exports = {
  queryInstitutions,
  iterateInstitutions,
  coverageCounts,
  facetValues,
  sanitizeFtsQuery,
  FILTERABLE_COLUMNS,
  SORTABLE_COLUMNS,
  COVERAGE_COLUMNS,
  PUBLIC_MAX_PAGE_SIZE,
  FULL_MAX_PAGE_SIZE,
};
