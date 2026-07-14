const { normalizedKey } = require('./normalize');

// Priorytet źródeł przy konflikcie pól: GUS > RIK > KRS > seed.
const SOURCE_PRIORITY = { gus: 4, rik: 3, krs: 2, ceidg: 1, seed: 0 };

// Klucz deduplikacji: REGON, gdy dostępny; w przeciwnym razie
// nazwa znormalizowana + kod pocztowy + numer domu.
function dedupKey(record) {
  if (record.regon) return `regon:${record.regon}`;
  return `fallback:${normalizedKey(record.name)}|${record.postal_code || ''}|${record.building_no || ''}`;
}

// Scala nowy rekord z istniejącym wg priorytetu źródeł: pole ze źródła
// o wyższym priorytecie nadpisuje, ale tylko jeśli nowa wartość nie jest pusta.
function mergeRecord(existing, incoming, incomingSource) {
  const existingPriority = existing.__source ? SOURCE_PRIORITY[existing.__source] ?? -1 : -1;
  const incomingPriority = SOURCE_PRIORITY[incomingSource] ?? -1;
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null || value === '') continue;
    const existingValue = existing[key];
    if (existingValue === undefined || existingValue === null || existingValue === '') {
      merged[key] = value;
    } else if (incomingPriority >= existingPriority) {
      merged[key] = value;
    }
  }
  merged.__source = incomingPriority >= existingPriority ? incomingSource : existing.__source;
  return merged;
}

module.exports = { dedupKey, mergeRecord, SOURCE_PRIORITY };
