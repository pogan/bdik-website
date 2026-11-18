const crypto = require('crypto');
const db = require('../db');

// Adresy IP nie trafiają do bazy w jawnej postaci - tylko hash, wystarczający
// do policzenia unikalnych odwiedzających bez przechowywania danych osobowych.
function hashIp(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

// Tabela visits to archiwum starego licznika (bez widoku, eksport: scripts/eksport-starych-statystyk.js); odsłony
// liczy teraz vamude-kit (lib/siteStats.js). Hash IP poniżej służy już tylko
// zdarzeniom lejka (events, event_log).
const countVisits = db.prepare('SELECT COUNT(*) AS n FROM visits');

// Zamknięta lista zdarzeń lejka. Etykiety trafiają do eksportu lejka (lib/stats.js),
// kolejność wpisów wyznacza kolejność kroków lejka.
const EVENTS = {
  filter_change: 'Zmienili filtr',
  sample_download: 'Pobrali przykładowy PDF',
  export_modal: 'Otworzyli okno eksportu',
  quote_view: 'Zobaczyli wycenę',
  consents_ok: 'Zaznaczyli zgody',
  checkout_start: 'Przeszli do płatności',
  lead_saved: 'Zostawili e-mail po próbkę',
};

// Zdarzenia, które wolno zgłosić z przeglądarki (POST /api/events/:name).
// Pozostałe (wycena, start płatności) rejestruje wyłącznie serwer - inaczej
// dowolny skrypt mógłby sztucznie pompować dolne kroki lejka.
const CLIENT_EVENTS = new Set(['filter_change', 'sample_download', 'export_modal', 'consents_ok']);

const upsertEvent = db.prepare(`
  INSERT INTO events (ip_hash, name) VALUES (?, ?)
  ON CONFLICT(ip_hash, name) DO UPDATE SET hits = hits + 1, last_seen = datetime('now')
`);
// events liczy ludzi (jeden wiersz na osobę i zdarzenie), event_log - każde
// wystąpienie z metadanymi (np. kwota widzianej wyceny).
const insertLog = db.prepare('INSERT INTO event_log (ip_hash, name, meta) VALUES (?, ?, ?)');
const countEvent = db.prepare('SELECT COUNT(*) AS people FROM events WHERE name = ?');

function visitCount() {
  return countVisits.get().n;
}

function isKnownEvent(name) {
  return Object.prototype.hasOwnProperty.call(EVENTS, name);
}

// true = zdarzenie wolno przyjąć z przeglądarki (patrz CLIENT_EVENTS).
function isClientEvent(name) {
  return CLIENT_EVENTS.has(name);
}

function recordEvent(ip, name, meta = null) {
  if (!ip || !isKnownEvent(name)) return false;
  const ipHash = hashIp(ip);
  upsertEvent.run(ipHash, name);
  insertLog.run(ipHash, name, meta ? JSON.stringify(meta) : null);
  return true;
}

function eventStats() {
  return Object.entries(EVENTS).map(([name, label]) => ({
    name,
    label,
    value: countEvent.get(name).people,
  }));
}

module.exports = { visitCount, recordEvent, isKnownEvent, isClientEvent, eventStats, EVENTS };
