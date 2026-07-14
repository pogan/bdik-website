// Rejestr Instytucji Kultury (RIK) NIE ma jednego ogólnopolskiego API - rejestr
// jest z definicji rozproszony (każdy organizator prowadzi własny na BIP-ie).
// Maszynowo dostępny jest RIK MKiDN przez REST API Otwartych Danych.
// Domyślnie moduł czyta fixture (dane testowe); RIK_LIVE=true włącza żywe API.
const https = require('https');
const fs = require('fs');
const path = require('path');
const { parseCsvToObjects } = require('../lib/csv');
const {
  padRegon,
  isValidRegon,
  normalizePhone,
  normalizeWebsite,
  normalizeEmail,
  normalizeName,
  normalizedKey,
} = require('../etl/normalize');

const RIK_API_URL =
  'https://api.dane.gov.pl/resources/34194,rejestr-instytucji-kultury-dla-ktorych-organizatorem-jest-minister-kultury-i-dziedzictwa-narodowego-csv/file';
const FIXTURE_PATH = path.join(__dirname, '__fixtures__', 'rik.csv');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(fetchUrl(res.headers.location));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`RIK API zwróciło HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

module.exports = {
  name: 'rik',

  async *fetch(opts = {}) {
    const live = opts.live ?? process.env.RIK_LIVE === 'true';
    const text = live ? await fetchUrl(RIK_API_URL) : fs.readFileSync(FIXTURE_PATH, 'utf8');
    for (const row of parseCsvToObjects(text)) {
      yield row;
    }
  },

  toCanonical(raw) {
    const regon = padRegon(raw['REGON'] || raw['Regon'] || '');
    const name = raw['Nazwa instytucji'] || raw['Nazwa'] || '';
    return {
      regon,
      regon_valid: isValidRegon(regon) ? 1 : 0,
      nip: (raw['NIP'] || '').trim(),
      source_ref: (raw['Nr RIK'] || raw['Numer w rejestrze'] || '').trim(),
      krs: '',
      name: normalizeName(name),
      name_normalized: normalizedKey(name),
      legal_form: 'PAŃSTWOWA INSTYTUCJA KULTURY',
      voivodeship: normalizeName(raw['Województwo']),
      county: '',
      commune: '',
      locality: normalizeName(raw['Miejscowość']),
      street: normalizeName(raw['Ulica']),
      building_no: (raw['Nr domu'] || '').trim(),
      unit_no: '',
      postal_code: (raw['Kod pocztowy'] || '').trim(),
      post_office: normalizeName(raw['Miejscowość']),
      phone: normalizePhone(raw['Telefon']),
      fax: '',
      email: normalizeEmail(raw['E-mail'] || raw['Email']),
      website: normalizeWebsite(raw['WWW'] || raw['Strona internetowa']),
      pkd_main_code: '',
      pkd_main_desc: '',
      employment_band: '',
      activity_start_date: '',
      founded_date: '',
    };
  },
};
