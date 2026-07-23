const crypto = require('crypto');
const db = require('../db');

// Adresy IP nie trafiają do bazy w jawnej postaci - tylko hash, wystarczający
// do policzenia unikalnych odwiedzających bez przechowywania danych osobowych.
function hashIp(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

// Źródło wizyty zapisujemy tylko przy PIERWSZYM wejściu (atrybucja first-touch);
// kolejne wejścia tej samej osoby aktualizują wyłącznie last_seen.
const upsertVisit = db.prepare(`
  INSERT INTO visits (ip_hash, referrer, utm_source, utm_medium, utm_campaign, landing_path)
  VALUES (@ip_hash, @referrer, @utm_source, @utm_medium, @utm_campaign, @landing_path)
  ON CONFLICT(ip_hash) DO UPDATE SET last_seen = datetime('now')
`);
const countVisits = db.prepare('SELECT COUNT(*) AS n FROM visits');

// Zamknięta lista zdarzeń lejka. Etykiety trafiają do panelu /admin/stats,
// kolejność wpisów wyznacza kolejność kroków lejka.
const EVENTS = {
  filter_change: 'Zmienili filtr',
  sample_download: 'Pobrali przykładowy PDF',
  export_modal: 'Otworzyli okno eksportu',
  quote_view: 'Zobaczyli wycenę',
  consents_ok: 'Zaznaczyli zgody',
  checkout_start: 'Przeszli do płatności',
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

function recordVisit(ip, meta = {}) {
  if (!ip) return;
  const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null);
  upsertVisit.run({
    ip_hash: hashIp(ip),
    referrer: clean(meta.referrer),
    utm_source: clean(meta.utmSource),
    utm_medium: clean(meta.utmMedium),
    utm_campaign: clean(meta.utmCampaign),
    landing_path: clean(meta.landingPath),
  });
}

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

module.exports = { recordVisit, visitCount, recordEvent, isKnownEvent, isClientEvent, eventStats, EVENTS };
