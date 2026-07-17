const crypto = require('crypto');
const db = require('../db');

// Adresy IP nie trafiają do bazy w jawnej postaci - tylko hash, wystarczający
// do policzenia unikalnych odwiedzających bez przechowywania danych osobowych.
function hashIp(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

const upsertVisit = db.prepare(`
  INSERT INTO visits (ip_hash) VALUES (?)
  ON CONFLICT(ip_hash) DO UPDATE SET last_seen = datetime('now')
`);
const countVisits = db.prepare('SELECT COUNT(*) AS n FROM visits');

// Zamknięta lista - nazwa zdarzenia przychodzi z przeglądarki, więc bez tego
// dowolny POST mógłby zapychać tabelę własnymi kluczami.
const EVENTS = {
  sample_download: 'Osoby, które pobrały przykład',
  filter_change: 'Osoby, które zmieniły filtr',
  export_modal: 'Osoby, które otworzyły modal eksportu',
};

const upsertEvent = db.prepare(`
  INSERT INTO events (ip_hash, name) VALUES (?, ?)
  ON CONFLICT(ip_hash, name) DO UPDATE SET hits = hits + 1, last_seen = datetime('now')
`);
// Wszystkie trzy liczniki pokazują ludzi, nie kliknięcia - jeden wiersz na
// (osoba, zdarzenie), więc wystarczy COUNT(*). Kolumna hits zostaje w tabeli
// jako materiał na ewentualne "ile razy", ale nigdzie jej nie pokazujemy.
const countEvent = db.prepare('SELECT COUNT(*) AS people FROM events WHERE name = ?');

function recordVisit(ip) {
  if (!ip) return;
  upsertVisit.run(hashIp(ip));
}

function visitCount() {
  return countVisits.get().n;
}

function isKnownEvent(name) {
  return Object.prototype.hasOwnProperty.call(EVENTS, name);
}

function recordEvent(ip, name) {
  if (!ip || !isKnownEvent(name)) return false;
  upsertEvent.run(hashIp(ip), name);
  return true;
}

function eventStats() {
  return Object.entries(EVENTS).map(([name, label]) => ({
    label,
    value: countEvent.get(name).people,
  }));
}

module.exports = { recordVisit, visitCount, recordEvent, isKnownEvent, eventStats };
