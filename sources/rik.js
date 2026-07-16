// Rejestr Instytucji Kultury (RIK) NIE ma jednego ogólnopolskiego API - rejestr
// jest z definicji rozproszony (każdy organizator prowadzi własny na BIP-ie).
// Maszynowo dostępny jest RIK MKiDN przez REST API Otwartych Danych.
// Domyślnie moduł czyta fixture (dane testowe); RIK_LIVE=true włącza żywe API.
const https = require('https');
const { readFixture } = require('./fixtures');
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

// CSV z dane.gov.pl jest w Windows-1250, nie w UTF-8 - dlatego zbieramy bufory
// i dekodujemy na końcu, zamiast ustawiać res.setEncoding('utf8').
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
        const chunks = [];
        res.on('data', (chunk) => { chunks.push(chunk); });
        res.on('end', () => resolve(decodeCp1250(Buffer.concat(chunks))));
      })
      .on('error', reject);
  });
}

function decodeCp1250(buf) {
  return new TextDecoder('windows-1250').decode(buf);
}

// RIK podaje siedzibę jako jedno pole tekstowe ("ul. Jasna 5 00-950 Warszawa").
// Kod pocztowy jest jedynym pewnym punktem zaczepienia: co przed nim to ulica
// z numerem, co po nim to miejscowość.
function parseSeat(seat) {
  const text = (seat || '').trim();
  // W rejestrze zdarza się literówka "00=641" zamiast "00-641".
  const match = text.match(/(\d{2})[-=](\d{3})/);
  if (!match) return { street: text, building_no: '', postal_code: '', locality: '' };

  const postal = `${match[1]}-${match[2]}`;
  const before = text.slice(0, match.index).trim();
  const locality = text.slice(match.index + match[0].length).trim();

  const building = before.match(/\s(\d+[A-Za-z]?(?:\/\d+[A-Za-z]?)*)$/);
  return {
    street: building ? before.slice(0, building.index).trim() : before,
    building_no: building ? building[1] : '',
    postal_code: postal,
    locality,
  };
}

// Jedna instytucja to w RIK kilka wierszy: wiersz z numerem wpisu zakłada
// wpis, kolejne (bez numeru) to zmiany - nadanie statutu, przeniesienie
// siedziby, zmiana nazwy. Liczy się stan bieżący, więc zwijamy każdy wpis do
// jednego rekordu, w którym późniejsza niepusta wartość nadpisuje wcześniejszą.
// Bez tego zmiana nazwy trafiłaby do bazy jako druga, osobna instytucja.
const ENTRY_NO = 'Numer wpisu do rejestru';

function foldEntries(rows) {
  const entries = [];
  let current = null;

  for (const row of rows) {
    if ((row[ENTRY_NO] || '').trim()) {
      current = { ...row };
      entries.push(current);
      continue;
    }
    if (!current) continue;
    for (const [key, value] of Object.entries(row)) {
      if (key !== ENTRY_NO && (value || '').trim()) current[key] = value;
    }
  }

  return entries.filter((e) => (e['Pełna nazwa instytucji kultury'] || '').trim());
}

function isLive(opts = {}) {
  return opts.live ?? process.env.RIK_LIVE === 'true';
}

module.exports = {
  name: 'rik',

  // Jedyne źródło, które fixture'a używa tylko zastępczo: z RIK_LIVE=true czyta
  // żywe API i wolno mu iść na produkcję. Bez tego czyta dane testowe, więc ETL
  // pomija je przy NODE_ENV=production (etl/run.js).
  usesFixtures(opts = {}) {
    return !isLive(opts);
  },

  async *fetch(opts = {}) {
    const live = isLive(opts);
    const text = live ? await fetchUrl(RIK_API_URL) : readFixture('rik.csv');
    for (const entry of foldEntries(parseCsvToObjects(text, ';'))) {
      yield entry;
    }
  },

  // RIK MKiDN nie publikuje REGON-u, NIP-u ani danych kontaktowych - stąd puste
  // pola poniżej. Wnosi nazwę i adres, resztę dokłada GUS (wyższy priorytet).
  toCanonical(raw) {
    const regon = padRegon(raw['REGON'] || raw['Regon'] || '');
    const name = raw['Pełna nazwa instytucji kultury'] || '';
    const seat = parseSeat(raw['Siedziba i adres instytucji kultury']);
    return {
      regon,
      regon_valid: isValidRegon(regon) ? 1 : 0,
      nip: (raw['NIP'] || '').trim(),
      source_ref: (raw['Numer wpisu do rejestru'] || '').trim(),
      krs: '',
      name: normalizeName(name),
      name_normalized: normalizedKey(name),
      legal_form: 'PAŃSTWOWA INSTYTUCJA KULTURY',
      voivodeship: '',
      county: '',
      commune: '',
      locality: normalizeName(seat.locality),
      street: normalizeName(seat.street),
      building_no: seat.building_no,
      unit_no: '',
      postal_code: seat.postal_code,
      post_office: normalizeName(seat.locality),
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
