const db = require('../db');
const { visitCount, eventStats } = require('./visits');
const { formatAmount } = require('./pricing');

// Zapytania panelu /admin/stats. Wszystko liczone z własnych tabel (visits,
// events, event_log, orders) - bez zewnętrznej analityki i bez cookies.

// Kroki dolnej części lejka bierzemy z orders (źródło prawdy o pieniądzach);
// górne - z events (unikalne osoby). Jednostki się różnią (osoby vs zamówienia),
// więc każdemu wierszowi dopisujemy jednostkę.
const countOrders = db.prepare("SELECT COUNT(*) AS n FROM orders");
const countPaidOrders = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'paid'");
const paidRevenue = db.prepare("SELECT COALESCE(SUM(amount), 0) AS net FROM orders WHERE status = 'paid'");

function funnel() {
  const visits = visitCount();
  const events = eventStats();
  const rows = [
    { label: 'Odwiedzili stronę', value: visits, unit: 'osoby' },
    ...events.map((e) => ({ label: e.label, value: e.value, unit: 'osoby' })),
    { label: 'Założone zamówienia', value: countOrders.get().n, unit: 'zamówienia' },
    { label: 'Opłacone zamówienia', value: countPaidOrders.get().n, unit: 'zamówienia' },
  ];
  // Procent względem pierwszego kroku (odwiedzin) - pokazuje, gdzie lejek się urywa.
  return rows.map((r) => ({
    ...r,
    pctOfVisits: visits > 0 ? Math.round((r.value / visits) * 1000) / 10 : null,
  }));
}

// Rozkład kwot brutto widzianych w wycenach (meta.gross w groszach) - odpowiada
// na kluczowe pytanie: przy jakiej cenie ludzie rezygnują. Liczymy zdarzenia
// i osoby osobno, bo jedna osoba potrafi obejrzeć wiele wycen.
const QUOTE_BUCKETS = [
  { upTo: 2500, label: 'do 25 zł' },
  { upTo: 5000, label: '25–50 zł' },
  { upTo: 10000, label: '50–100 zł' },
  { upTo: 25000, label: '100–250 zł' },
  { upTo: 50000, label: '250–500 zł' },
  { upTo: 100000, label: '500–1000 zł' },
  { upTo: Infinity, label: 'powyżej 1000 zł' },
];

const selectQuotes = db.prepare(`
  SELECT ip_hash, CAST(json_extract(meta, '$.gross') AS INTEGER) AS gross
  FROM event_log WHERE name = 'quote_view' AND meta IS NOT NULL
`);

function quoteBuckets() {
  const buckets = QUOTE_BUCKETS.map((b) => ({ label: b.label, upTo: b.upTo, views: 0, people: new Set() }));
  for (const row of selectQuotes.all()) {
    if (!Number.isFinite(row.gross)) continue;
    const bucket = buckets.find((b) => row.gross <= b.upTo);
    bucket.views += 1;
    bucket.people.add(row.ip_hash);
  }
  return buckets
    .map((b) => ({ label: b.label, views: b.views, people: b.people.size }))
    .filter((b) => b.views > 0);
}

// Źródła pierwszej wizyty: kampanie UTM osobno, resztę grupujemy po hoście
// referrera; wejścia bez żadnego śladu = "bezpośrednie / nieoznaczone".
const selectSources = db.prepare('SELECT utm_source, utm_medium, utm_campaign, referrer FROM visits');

function refererHost(referrer) {
  try {
    return new URL(referrer).host || null;
  } catch (_) {
    return null;
  }
}

function sources() {
  const counts = new Map();
  for (const v of selectSources.all()) {
    let key;
    if (v.utm_source) {
      key = `${v.utm_source}${v.utm_medium ? ` / ${v.utm_medium}` : ''}${v.utm_campaign ? ` (${v.utm_campaign})` : ''}`;
    } else {
      key = refererHost(v.referrer) || 'bezpośrednie / nieoznaczone';
    }
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);
}

// Dzienny przebieg ostatnich 30 dni: nowi odwiedzający (pierwsza wizyta),
// obejrzane wyceny, założone i opłacone zamówienia.
const dailyVisits = db.prepare(`
  SELECT date(first_seen) AS day, COUNT(*) AS n FROM visits
  WHERE first_seen >= datetime('now', '-30 days') GROUP BY day
`);
const dailyQuotes = db.prepare(`
  SELECT date(ts) AS day, COUNT(*) AS n FROM event_log
  WHERE name = 'quote_view' AND ts >= datetime('now', '-30 days') GROUP BY day
`);
const dailyOrders = db.prepare(`
  SELECT date(created_at) AS day, COUNT(*) AS n FROM orders
  WHERE created_at >= datetime('now', '-30 days') GROUP BY day
`);
const dailyPaid = db.prepare(`
  SELECT date(paid_at) AS day, COUNT(*) AS n FROM orders
  WHERE status = 'paid' AND paid_at >= datetime('now', '-30 days') GROUP BY day
`);

function daily() {
  const days = new Map();
  const add = (rows, key) => {
    for (const r of rows) {
      if (!days.has(r.day)) days.set(r.day, { day: r.day, visitors: 0, quotes: 0, orders: 0, paid: 0 });
      days.get(r.day)[key] = r.n;
    }
  };
  add(dailyVisits.all(), 'visitors');
  add(dailyQuotes.all(), 'quotes');
  add(dailyOrders.all(), 'orders');
  add(dailyPaid.all(), 'paid');
  return [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

// Suma przychodu z opłaconych zamówień (orders.amount trzyma NETTO).
function revenue() {
  const net = paidRevenue.get().net;
  return { netLabel: formatAmount(net) };
}

module.exports = { funnel, quoteBuckets, sources, daily, revenue };
