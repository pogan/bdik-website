// Źródło zamówienia (kampania / strona odsyłająca) bez ciasteczek i bez
// zapisu w przeglądarce. vamude-kit zapisuje odsłony w tej samej bazie
// (vk_pageviews) z identyfikatorem odwiedzającego = HMAC(sekret, IP + rodzina
// przeglądarki + system). Przy tworzeniu zamówienia liczymy ten sam
// identyfikator dla żądania checkoutu i bierzemy NAJNOWSZĄ odsłonę tej osoby
// z UTM albo z zewnętrznym referrerem z ostatnich 30 dni (model "ostatnie
// niebezpośrednie wejście").
//
// Ograniczenia: zmiana IP (telefon w sieci komórkowej, inna sieć) albo
// przeglądarki = brak dopasowania i zamówienie bez źródła. Wtedy porównujemy
// daty publikacji z datami zamówień.
//
// Uwaga przy aktualizacji vamude-kit: wzór identyfikatora musi zgadzać się z
// visitorId() w vamude-kit/lib/stats.js - pilnuje tego tests/attribution.test.js.
const crypto = require('crypto');
const { parseUserAgent } = require('vamude-kit/lib/userAgent');
const db = require('../db');

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

let secret = null;
function statsSecret() {
  if (secret) return secret;
  try {
    const row = db.prepare("SELECT value FROM vk_meta WHERE key = 'secret'").get();
    secret = row ? row.value : null;
  } catch {
    secret = null; // tabele statystyk jeszcze nie istnieją
  }
  return secret;
}

function visitorIdFor(req) {
  const key = statsSecret();
  if (!key) return null;
  const ua = parseUserAgent(req.get('user-agent') || '');
  return crypto.createHmac('sha256', key).update(`${req.ip || ''}|${ua.browser}|${ua.os}`).digest('hex').slice(0, 32);
}

let lastTouch = null;
function sourceFor(req, now = Date.now()) {
  const visitor = visitorIdFor(req);
  if (!visitor) return null;
  if (!lastTouch) {
    lastTouch = db.prepare(`
      SELECT utm_source, utm_medium, utm_campaign, referrer_host, ts
      FROM vk_pageviews
      WHERE visitor = ? AND ts >= ?
        AND (utm_source IS NOT NULL OR utm_campaign IS NOT NULL OR referrer_host IS NOT NULL)
      ORDER BY ts DESC LIMIT 1
    `);
  }
  const row = lastTouch.get(visitor, now - WINDOW_MS);
  if (!row) return null;
  return {
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmCampaign: row.utm_campaign,
    referrerHost: row.referrer_host,
    seenAt: new Date(row.ts).toISOString(),
  };
}

// Krótki opis do panelu: "kampania · źródło/medium" albo host strony odsyłającej.
function describeSource(order) {
  if (order.source_utm_campaign || order.source_utm_source) {
    const via = [order.source_utm_source, order.source_utm_medium].filter(Boolean).join('/');
    return [order.source_utm_campaign, via].filter(Boolean).join(' · ');
  }
  return order.source_referrer || null;
}

// Klucz grupowania w podsumowaniu: kampania, a bez niej źródło lub host.
function sourceKey(order) {
  return order.source_utm_campaign || order.source_utm_source || order.source_referrer || '(bez źródła)';
}

module.exports = { sourceFor, describeSource, sourceKey, visitorIdFor, WINDOW_MS };
