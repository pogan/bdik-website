// GUS/REGON: ponieważ CSV źródłowy ma już REGON dla ~wszystkich rekordów,
// to źródło pełni rolę wzbogacania po znanym REGON-ie (BIR1 SearchData),
// a nie odkrywania nowych instytucji jak RIK/KRS/CEIDG.
// Mock: fixture JSON. Docelowo klient SOAP/REST GUS BIR wymaga klucza API
// (wniosek do GUS) - stąd na razie brak żywego trybu.
const fs = require('fs');
const path = require('path');
const {
  padRegon,
  isValidRegon,
  normalizePhone,
  normalizeEmail,
  normalizeName,
  normalizedKey,
  normalizeDate,
  splitPkd,
} = require('../etl/normalize');

const FIXTURE_PATH = path.join(__dirname, '__fixtures__', 'gus.json');

module.exports = {
  name: 'gus',

  async *fetch() {
    const records = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
    for (const record of records) {
      yield record;
    }
  },

  toCanonical(raw) {
    const regon = padRegon(raw['Regon'] || '');
    const pkd = splitPkd(raw['GlownyPkd']);
    return {
      regon,
      regon_valid: isValidRegon(regon) ? 1 : 0,
      nip: (raw['Nip'] || '').trim(),
      source_ref: '',
      krs: '',
      name: normalizeName(raw['Nazwa']),
      name_normalized: normalizedKey(raw['Nazwa']),
      legal_form: '',
      voivodeship: normalizeName(raw['Wojewodztwo']),
      county: normalizeName(raw['Powiat']),
      commune: normalizeName(raw['Gmina']),
      locality: normalizeName(raw['Miejscowosc']),
      street: normalizeName(raw['Ulica']),
      building_no: (raw['NrNieruchomosci'] || '').trim(),
      unit_no: '',
      postal_code: (raw['KodPocztowy'] || '').trim(),
      post_office: normalizeName(raw['Miejscowosc']),
      phone: normalizePhone(raw['NumerTelefonu']),
      fax: '',
      email: normalizeEmail(raw['AdresEmail']),
      website: '',
      pkd_main_code: pkd.code,
      pkd_main_desc: pkd.desc,
      employment_band: '',
      activity_start_date: normalizeDate(raw['DataRozpoczeciaDzialalnosci']),
      founded_date: '',
    };
  },
};
