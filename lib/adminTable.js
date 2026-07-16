// Opis widoku bazy dla administratora: które kolumny tabeli institutions
// pokazać i jak każdą z nich filtrować. Spec powstaje z tych samych list, na
// których opiera się SQL (lib/query.js) i projekcja pól (lib/projection.js),
// więc front nie może zaoferować filtra, którego backend nie obsłuży.

const { ADMIN_FIELDS } = require('./projection');
const { ADMIN_FIELD_LABELS } = require('./fieldLabels');
const {
  ADMIN_EXACT_COLUMNS,
  ADMIN_LIKE_COLUMNS,
  ADMIN_FACET_COLUMNS,
  FILTERABLE_COLUMNS,
  SORTABLE_COLUMNS,
} = require('./query');

// Cztery poziomy kaskady mają własne selekty nad tabelą - w panelu filtrów
// administratora ich nie powtarzamy.
const HIERARCHY = ['voivodeship', 'county', 'commune', 'locality'];

function filterModeFor(key) {
  if (ADMIN_FACET_COLUMNS.includes(key)) return 'facet';
  if (ADMIN_LIKE_COLUMNS.includes(key)) return 'like';
  if (ADMIN_EXACT_COLUMNS.includes(key) || FILTERABLE_COLUMNS.includes(key)) return 'exact';
  return null;
}

function adminViewSpec() {
  return ADMIN_FIELDS.map((key) => ({
    key,
    label: ADMIN_FIELD_LABELS[key] || key,
    filter: HIERARCHY.includes(key) ? null : filterModeFor(key),
    sortable: SORTABLE_COLUMNS.includes(key),
  }));
}

module.exports = { adminViewSpec };
