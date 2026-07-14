// Cennik eksportu. Cena zależy wyłącznie od liczby rekordów w zestawie wyników,
// więc liczymy ją TYLKO na serwerze - kwota z przeglądarki nigdy nie jest brana
// pod uwagę (inaczej dałoby się kupić 50 tys. rekordów za grosz).
//
// Progi działają jak progi podatkowe: kolejne rekordy powyżej progu są tańsze,
// dzięki czemu cena rośnie płynnie i nie skacze o setki złotych na granicy.

const CURRENCY = 'pln';

const MIN_AMOUNT = 1900; // 19,00 zł - nawet mały wycinek kosztuje tyle co kawa
const MAX_AMOUNT = 49900; // 499,00 zł - sufit; powyżej i tak jest to "cała baza"

const TIERS = [
  { upTo: 100, perRow: 25 }, // 0,25 zł / rekord
  { upTo: 1000, perRow: 15 },
  { upTo: 10000, perRow: 7 },
  { upTo: Infinity, perRow: 3 },
];

// Zwraca kwotę w groszach (Stripe operuje na najmniejszej jednostce waluty).
function priceFor(rowCount) {
  const rows = Math.max(0, Math.floor(Number(rowCount) || 0));
  if (rows === 0) return 0;

  let amount = 0;
  let previousCap = 0;
  for (const tier of TIERS) {
    if (rows <= previousCap) break;
    const rowsInTier = Math.min(rows, tier.upTo) - previousCap;
    amount += rowsInTier * tier.perRow;
    previousCap = tier.upTo;
  }

  return Math.min(Math.max(Math.round(amount), MIN_AMOUNT), MAX_AMOUNT);
}

function formatAmount(grosze) {
  return `${(grosze / 100).toFixed(2).replace('.', ',')} zł`;
}

const FORMAT_LABELS = { csv: 'CSV', xlsx: 'Excel (XLSX)', pdf: 'PDF' };

// Nazwa pozycji widoczna na stronie płatności Stripe i na paragonie.
function lineItemName(format, rowCount) {
  return `Eksport ${FORMAT_LABELS[format] || format.toUpperCase()} - ${rowCount} instytucji kultury`;
}

// Czytelny opis wybranych filtrów ("woj. pomorskie · pow. gdański · \"biblioteka\"").
function describeFilters(filters = {}) {
  const parts = [];
  if (filters.voivodeship) parts.push(`woj. ${filters.voivodeship.toLowerCase()}`);
  if (filters.county) parts.push(`pow. ${filters.county.toLowerCase()}`);
  if (filters.commune) parts.push(`gm. ${filters.commune.toLowerCase()}`);
  if (filters.locality) parts.push(filters.locality);
  if (filters.q) parts.push(`"${filters.q}"`);
  return parts.length ? parts.join(' · ') : 'cała baza (bez filtrów)';
}

module.exports = {
  CURRENCY,
  MIN_AMOUNT,
  MAX_AMOUNT,
  TIERS,
  FORMAT_LABELS,
  priceFor,
  formatAmount,
  lineItemName,
  describeFilters,
};
