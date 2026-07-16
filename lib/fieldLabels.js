// Etykiety kolumn używane przy eksporcie (kolejność = kolejność w pliku).
const FIELD_LABELS = {
  name: 'Nazwa',
  legal_form: 'Forma prawna',
  voivodeship: 'Województwo',
  county: 'Powiat',
  commune: 'Gmina',
  locality: 'Miejscowość',
  street: 'Ulica',
  building_no: 'Nr domu',
  unit_no: 'Nr lokalu',
  postal_code: 'Kod pocztowy',
  post_office: 'Poczta',
  phone: 'Telefon',
  fax: 'Fax',
  email: 'E-mail',
  website: 'WWW',
  regon: 'REGON',
  nip: 'NIP',
  pkd_main_code: 'Kod PKD',
  pkd_main_desc: 'Działalność (PKD)',
  employment_band: 'Zatrudnienie',
  activity_start_date: 'Data rozpoczęcia działalności',
  founded_date: 'Data powstania',
};

// Pełny zestaw dla CSV/XLSX (bez 'id', to wewnętrzny klucz techniczny).
const EXPORT_FIELDS_FULL = Object.keys(FIELD_LABELS);

// Etykiety pól widocznych wyłącznie w widoku administratora (kolumny techniczne
// i pomocnicze, których nie ma w żadnym eksporcie).
const ADMIN_FIELD_LABELS = {
  ...FIELD_LABELS,
  id: 'ID',
  regon_valid: 'REGON poprawny',
  primary_source: 'Źródło główne',
  source_ref: 'Identyfikator w źródle',
  krs: 'KRS',
  name_normalized: 'Nazwa (znormalizowana)',
  phone_normalized: 'Telefon (znormalizowany)',
  created_at: 'Dodano',
  updated_at: 'Zaktualizowano',
};

// Węższy zestaw dla PDF - przy ~20 kolumnach tabela przestaje się mieścić
// nawet na A3 poziomo i staje się nieczytelna.
const EXPORT_FIELDS_PDF = [
  'name', 'voivodeship', 'county', 'locality',
  'street', 'building_no', 'postal_code',
  'phone', 'email', 'website', 'regon',
];

function columnsFor(fieldKeys) {
  return fieldKeys.map((key) => ({ key, label: FIELD_LABELS[key] || key }));
}

module.exports = { FIELD_LABELS, ADMIN_FIELD_LABELS, EXPORT_FIELDS_FULL, EXPORT_FIELDS_PDF, columnsFor };
