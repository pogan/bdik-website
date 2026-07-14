// KRS: obejmuje spółki, fundacje i stowarzyszenia - dla samorządowych
// instytucji kultury (zdecydowana większość zbioru) zwróci praktycznie nic.
// Przydatne dla NGO-sów działających w kulturze (fundacje, stowarzyszenia).
// Mock: fixture JSON. Docelowo REST API: https://prs.ms.gov.pl/krs/openApi
const fs = require('fs');
const path = require('path');
const {
  padRegon,
  isValidRegon,
  normalizePhone,
  normalizeWebsite,
  normalizeEmail,
  normalizeName,
  normalizedKey,
} = require('../etl/normalize');

const FIXTURE_PATH = path.join(__dirname, '__fixtures__', 'krs.json');

module.exports = {
  name: 'krs',

  async *fetch() {
    const records = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
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
      source_ref: (raw['krsNumer'] || '').trim(),
      krs: (raw['krsNumer'] || '').trim(),
      name: normalizeName(raw['nazwa']),
      name_normalized: normalizedKey(raw['nazwa']),
      legal_form: normalizeName(raw['formaPrawna']),
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
      activity_start_date: '',
      founded_date: '',
    };
  },
};
