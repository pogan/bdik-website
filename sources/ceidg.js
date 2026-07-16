// CEIDG: jednoosobowe działalności gospodarcze. Dla samorządowych instytucji
// kultury nieistotne (są jednostkami budżetowymi, nie JDG) - przydatne
// głównie dla prywatnych galerii/pracowni prowadzonych jako działalność.
// Mock: fixture JSON. Docelowo REST API wg specyfikacji dane.gov.pl (CEIDG).
const { readJsonFixture } = require('./fixtures');
const {
  padRegon,
  isValidRegon,
  normalizePhone,
  normalizeWebsite,
  normalizeEmail,
  normalizeName,
  normalizedKey,
  normalizeDate,
} = require('../etl/normalize');

module.exports = {
  name: 'ceidg',

  // Źródło w całości oparte na fixture'ach (brak trybu żywego) - ETL pomija
  // je przy NODE_ENV=production, patrz etl/run.js.
  fixtureOnly: true,

  async *fetch() {
    const records = readJsonFixture('ceidg.json');
    for (const record of records) {
      yield record;
    }
  },

  toCanonical(raw) {
    const regon = padRegon(raw['regon'] || '');
    return {
      regon,
      regon_valid: isValidRegon(regon) ? 1 : 0,
      nip: (raw['nip'] || '').trim(),
      source_ref: '',
      krs: '',
      name: normalizeName(raw['firma']),
      name_normalized: normalizedKey(raw['firma']),
      legal_form: 'JEDNOOSOBOWA DZIAŁALNOŚĆ GOSPODARCZA',
      voivodeship: normalizeName(raw['wojewodztwo']),
      county: '',
      commune: '',
      locality: normalizeName(raw['miejscowosc']),
      street: normalizeName(raw['ulica']),
      building_no: (raw['nrDomu'] || '').trim(),
      unit_no: '',
      postal_code: (raw['kodPocztowy'] || '').trim(),
      post_office: normalizeName(raw['miejscowosc']),
      phone: normalizePhone(raw['telefon']),
      fax: '',
      email: normalizeEmail(raw['email']),
      website: normalizeWebsite(raw['www']),
      pkd_main_code: '',
      pkd_main_desc: '',
      employment_band: '',
      activity_start_date: normalizeDate(raw['dataRozpoczecia']),
      founded_date: '',
    };
  },
};
