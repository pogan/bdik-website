const REGON9_WEIGHTS = [8, 9, 2, 3, 4, 5, 6, 7];
const REGON14_WEIGHTS = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8];

function padRegon(raw) {
  const digits = (raw || '').trim();
  if (!digits) return '';
  if (/^\d+$/.test(digits) === false) return digits;
  if (digits.length <= 9) return digits.padStart(9, '0');
  if (digits.length <= 14) return digits.padStart(14, '0');
  return digits;
}

function isValidRegon(regon) {
  if (!regon || !/^\d+$/.test(regon)) return false;
  let weights;
  if (regon.length === 9) weights = REGON9_WEIGHTS;
  else if (regon.length === 14) weights = REGON14_WEIGHTS;
  else return false;
  const sum = regon
    .slice(0, weights.length)
    .split('')
    .reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
  const check = (sum % 11) % 10;
  return check === Number(regon[regon.length - 1]);
}

function normalizePhone(raw) {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('48') && digits.length === 11) return `+${digits}`;
  if (digits.length === 9) return `+48${digits}`;
  return `+${digits}`;
}

function normalizeWebsite(raw) {
  if (!raw) return '';
  let url = raw.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, '');
}

function normalizeEmail(raw) {
  if (!raw) return '';
  return raw.trim().toLowerCase();
}

// Wejście: 'M/D/YYYY' (format US z Excela) -> ISO 'YYYY-MM-DD'
function normalizeDate(raw) {
  if (!raw) return '';
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  const [, month, day, year] = m;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function normalizeEmploymentBand(raw) {
  if (!raw) return '';
  return raw.replace(/^'/, '').trim();
}

// "90.04.Z - DZIAŁALNOŚĆ OBIEKTÓW KULTURALNYCH" -> { code, desc }
function splitPkd(raw) {
  if (!raw) return { code: '', desc: '' };
  const m = raw.match(/^([\d.A-Z]+)\s*-\s*(.+)$/);
  if (!m) return { code: '', desc: raw.trim() };
  return { code: m[1].trim(), desc: m[2].trim() };
}

// Naprawa Title Case z Excela: "Ul. Bordynowska", "W Grabówce" -> zachowujemy
// jak jest, ale przycinamy białe znaki i normalizujemy wielokrotne spacje.
function normalizeName(raw) {
  if (!raw) return '';
  return raw.trim().replace(/\s+/g, ' ');
}

const DIACRITICS_RE = /[̀-ͯ]/g;

function normalizedKey(raw) {
  return normalizeName(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
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
};
