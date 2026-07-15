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

// Ceny w cenniku (TIERS) są NETTO - VAT doliczamy na wierzchu, klient płaci brutto.
const VAT_RATE = 0.23;

// Kwota VAT (w groszach) od podanej kwoty netto, zaokrąglona do pełnego grosza -
// tak samo jak Stripe liczy podatek dla pozycji z quantity=1, żeby brutto się zgadzało.
function vatFromNet(net) {
  return Math.round(Math.max(0, Number(net) || 0) * VAT_RATE);
}

// Rozbicie kwoty netto na VAT i brutto. Netto jest źródłem prawdy (zapisane w
// zamówieniu jako amount) - brutto liczymy zawsze z niego, nie odwrotnie, żeby
// zaokrąglenie się nie "rozjeżdżało" przy odtwarzaniu z brutto.
function breakdownFromNet(net) {
  const netAmount = Math.max(0, Math.round(Number(net) || 0));
  const vat = vatFromNet(netAmount);
  return { net: netAmount, vat, gross: netAmount + vat };
}

// Pełne rozbicie dla danej liczby rekordów: netto z cennika + VAT + brutto oraz
// średnia cena netto za rekord (progi kaskadowe dają różne stawki, stąd średnia).
function priceBreakdown(rowCount) {
  const rows = Math.max(0, Math.floor(Number(rowCount) || 0));
  const { net, vat, gross } = breakdownFromNet(priceFor(rows));
  return { rowCount: rows, perRow: rows > 0 ? net / rows : 0, net, vat, gross };
}

// Cena za rekord bywa ułamkiem grosza (np. 0,196 zł) - pokazujemy 3 miejsca.
function formatPricePerRow(grosze) {
  return `${((Number(grosze) || 0) / 100).toFixed(3).replace('.', ',')} zł`;
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
  VAT_RATE,
  FORMAT_LABELS,
  priceFor,
  vatFromNet,
  breakdownFromNet,
  priceBreakdown,
  formatAmount,
  formatPricePerRow,
  lineItemName,
  describeFilters,
};
