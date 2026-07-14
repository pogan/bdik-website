const fs = require('fs');
const path = require('path');
const { parseCsvToObjects } = require('../lib/csv');
const {
  padRegon,
  isValidRegon,
  normalizePhone,
  normalizeWebsite,
  normalizeEmail,
  normalizeDate,
  normalizeEmploymentBand,
  splitPkd,
  normalizeName,
  normalizedKey,
} = require('../etl/normalize');

const CSV_PATH = path.join(__dirname, '..', 'kk_claude_data', 'druga_baza_danych.csv');

module.exports = {
  name: 'seed',

  // yield surowych rekordów (obiekty 1:1 z kolumnami CSV)
  async *fetch() {
    const text = fs.readFileSync(CSV_PATH, 'utf8');
    const rows = parseCsvToObjects(text);
    for (const row of rows) {
      yield row;
    }
  },

  // surowy wiersz CSV -> kanoniczny kształt rekordu institutions
  toCanonical(raw) {
    const regon = padRegon(raw['Regon']);
    const pkd = splitPkd(raw['Główny PKD']);
    return {
      regon,
      regon_valid: isValidRegon(regon) ? 1 : 0,
      nip: (raw['Nip'] || '').trim(),
      source_ref: (raw['Numer KRS'] || '').trim(),
      krs: '',
      name: normalizeName(raw['Nazwa firmy']),
      name_normalized: normalizedKey(raw['Nazwa firmy']),
      legal_form: (raw['Forma prawna'] || '').trim(),
      voivodeship: normalizeName(raw['Województwo']),
      county: normalizeName(raw['Powiat']),
      commune: normalizeName(raw['Gmina']),
      locality: normalizeName(raw['Miejscowość']),
      street: normalizeName(raw['Ulica']),
      building_no: (raw['Numer domu'] || '').trim(),
      unit_no: (raw['Numer lokalu'] || '').trim(),
      postal_code: (raw['Kod pocztowy'] || '').trim(),
      post_office: normalizeName(raw['Poczta']),
      phone: normalizePhone(raw['Telefon 1']),
      fax: normalizePhone(raw['Fax']),
      email: normalizeEmail(raw['Adres Email']),
      website: normalizeWebsite(raw['Adres WWW']),
      pkd_main_code: pkd.code,
      pkd_main_desc: pkd.desc,
      employment_band: normalizeEmploymentBand(raw['Zatrudnienie']),
      activity_start_date: normalizeDate(raw['Data rozpoczęcia działalności']),
      founded_date: normalizeDate(raw['Data powstania']),
    };
  },
};
