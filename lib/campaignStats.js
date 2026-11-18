// Sekcje sprzedażowe w panelu /kierownik/stats (vamude-kit, opcja `sections`):
// liczone dla okresu wybranego w panelu, np. kampanii 24.11–21.12. Dni liczymy
// w strefie Europe/Warsaw jak panel; daty w bazie są w UTC (datetime('now')).
//
// Zamówienia administratora (created_by_admin = 1) pomijamy wszędzie. Kwoty:
// orders.amount to NETTO, w tabelach pokazujemy brutto sprzed rabatu (kwotę po
// kodzie rabatowym widać w Stripe).
const { escapeHtml } = require('vamude-kit');
const db = require('../db');
const { EVENTS } = require('./visits');
const { formatAmount, breakdownFromNet } = require('./pricing');
const { sourceKey } = require('./attribution');
const siteStats = require('./siteStats');

const TZ = 'Europe/Warsaw';
const QUOTE_BUCKETS = [
  { upTo: 2500, label: 'do 25 zł' },
  { upTo: 5000, label: '25–50 zł' },
  { upTo: 10000, label: '50–100 zł' },
  { upTo: 25000, label: '100–250 zł' },
  { upTo: 50000, label: '250–500 zł' },
  { upTo: 100000, label: '500–1000 zł' },
  { upTo: Infinity, label: 'powyżej 1000 zł' },
];

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmt = (n) => Number(n || 0).toLocaleString('pl-PL');

// Północ dnia RRRR-MM-DD w Warszawie jako tekst UTC "RRRR-MM-DD HH:MM:SS" (format SQLite).
function warsawMidnightUtc(day) {
  const guess = Date.parse(`${day}T00:00:00Z`);
  const wall = new Date(new Date(guess).toLocaleString('en-US', { timeZone: TZ }));
  const utc = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess - (wall - utc)).toISOString().slice(0, 19).replace('T', ' ');
}

function nextDay(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Tekst UTC z bazy -> dzień w Warszawie.
const warsawDay = (utcText) => dayFmt.format(new Date(`${utcText.replace(' ', 'T')}Z`));

const peopleForEvent = db.prepare(
  'SELECT COUNT(DISTINCT ip_hash) AS n FROM event_log WHERE name = ? AND ts >= ? AND ts < ?'
);
const quotesIn = db.prepare(`
  SELECT ts, ip_hash, CAST(json_extract(meta, '$.gross') AS INTEGER) AS gross
  FROM event_log WHERE name = 'quote_view' AND ts >= ? AND ts < ?
`);
const ordersIn = db.prepare('SELECT * FROM orders WHERE created_by_admin = 0 AND created_at >= ? AND created_at < ?');
const paidIn = db.prepare(
  "SELECT * FROM orders WHERE created_by_admin = 0 AND status = 'paid' AND paid_at >= ? AND paid_at < ?"
);

// Wszystkie liczby dla okresu [from, to] (dni w Warszawie, włącznie).
function campaignData({ from, to }) {
  const start = warsawMidnightUtc(from);
  const end = warsawMidnightUtc(nextDay(to));
  const visitors = siteStats.summary({ from, to, limit: 1 }).visitors;
  const created = ordersIn.all(start, end);
  const paid = paidIn.all(start, end);
  const quotes = quotesIn.all(start, end);

  const funnel = [
    { label: 'Odwiedzili stronę', value: visitors, unit: 'osoby' },
    ...Object.entries(EVENTS).map(([name, label]) => ({ label, value: peopleForEvent.get(name, start, end).n, unit: 'osoby' })),
    { label: 'Założone zamówienia', value: created.length, unit: 'zamówienia' },
    { label: 'Opłacone zamówienia', value: paid.length, unit: 'zamówienia' },
  ].map((r) => ({ ...r, pct: visitors > 0 ? Math.round((r.value / visitors) * 1000) / 10 : null }));

  const net = paid.reduce((sum, o) => sum + o.amount, 0);

  const buckets = QUOTE_BUCKETS.map((b) => ({ ...b, views: 0, people: new Set() }));
  for (const q of quotes) {
    if (!Number.isFinite(q.gross)) continue;
    const b = buckets.find((x) => q.gross <= x.upTo);
    b.views += 1;
    b.people.add(q.ip_hash);
  }

  const sources = new Map();
  const bump = (o, field) => {
    const key = sourceKey(o);
    const s = sources.get(key) || { source: key, created: 0, paid: 0, gross: 0 };
    s[field] += 1;
    if (field === 'paid') s.gross += breakdownFromNet(o.amount).gross;
    sources.set(key, s);
  };
  created.forEach((o) => bump(o, 'created'));
  paid.forEach((o) => bump(o, 'paid'));

  const days = new Map();
  const day = (d) => days.get(d) || days.set(d, { day: d, quotes: 0, created: 0, paid: 0, gross: 0 }).get(d);
  quotes.forEach((q) => { day(warsawDay(q.ts)).quotes += 1; });
  created.forEach((o) => { day(warsawDay(o.created_at)).created += 1; });
  paid.forEach((o) => {
    const d = day(warsawDay(o.paid_at));
    d.paid += 1;
    d.gross += breakdownFromNet(o.amount).gross;
  });

  return {
    from,
    to,
    funnel,
    revenue: { paid: paid.length, net, netLabel: formatAmount(net), grossLabel: formatAmount(paid.reduce((s, o) => s + breakdownFromNet(o.amount).gross, 0)) },
    quotes: buckets.filter((b) => b.views > 0).map((b) => ({ label: b.label, views: b.views, people: b.people.size })),
    sources: [...sources.values()].sort((a, b) => b.gross - a.gross || b.created - a.created),
    daily: [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
  };
}

function render({ from, to }) {
  const d = campaignData({ from, to });
  const rows = (items, cells) => items.map((x) => `<tr>${cells(x)}</tr>`).join('');
  const empty = '<p class="muted">Brak danych w tym okresie.</p>';
  return `
<h2>Sprzedaż w okresie</h2>
<div class="tiles">
  <div class="tile"><b>${fmt(d.revenue.paid)}</b><span>Opłacone zamówienia</span></div>
  <div class="tile"><b>${escapeHtml(d.revenue.netLabel)}</b><span>Przychód netto</span></div>
  <div class="tile"><b>${escapeHtml(d.revenue.grossLabel)}</b><span>Brutto przed rabatem</span></div>
</div>
<div class="grid">
  <div><h2>Lejek: od wizyty do zapłaty</h2>
    <table><thead><tr><th>Krok</th><th class="n">Liczba</th><th class="n">% odwiedzin</th></tr></thead><tbody>${rows(
      d.funnel,
      (r) => `<td>${escapeHtml(r.label)} <span class="muted">(${r.unit})</span></td><td class="n">${fmt(r.value)}</td><td class="n">${r.pct === null ? '—' : `${r.pct.toLocaleString('pl-PL')}%`}</td>`
    )}</tbody></table></div>
  <div><h2>Zamówienia według źródła</h2>${
    d.sources.length
      ? `<table><thead><tr><th>Kampania / źródło</th><th class="n">Założone</th><th class="n">Opłacone</th><th class="n">Brutto</th></tr></thead><tbody>${rows(
          d.sources,
          (s) => `<td class="name">${escapeHtml(s.source)}</td><td class="n">${fmt(s.created)}</td><td class="n">${fmt(s.paid)}</td><td class="n">${escapeHtml(formatAmount(s.gross))}</td>`
        )}</tbody></table>`
      : empty
  }</div>
  <div><h2>Widziane wyceny (brutto)</h2>${
    d.quotes.length
      ? `<table><thead><tr><th>Przedział</th><th class="n">Wyceny</th><th class="n">Osoby</th></tr></thead><tbody>${rows(
          d.quotes,
          (q) => `<td>${escapeHtml(q.label)}</td><td class="n">${fmt(q.views)}</td><td class="n">${fmt(q.people)}</td>`
        )}</tbody></table>`
      : empty
  }</div>
  <div><h2>Sprzedaż dzień po dniu</h2>${
    d.daily.length
      ? `<table><thead><tr><th>Dzień</th><th class="n">Wyceny</th><th class="n">Założone</th><th class="n">Opłacone</th><th class="n">Brutto</th></tr></thead><tbody>${rows(
          d.daily,
          (x) => `<td>${x.day}</td><td class="n">${fmt(x.quotes)}</td><td class="n">${fmt(x.created)}</td><td class="n">${fmt(x.paid)}</td><td class="n">${escapeHtml(formatAmount(x.gross))}</td>`
        )}</tbody></table>`
      : empty
  }</div>
</div>
<p class="muted">Lejek i źródła bez zamówień administratora. Kroki lejka: osoby (bez ciasteczek, w przybliżeniu), zamówienia: sztuki. Źródło zamówienia: ostatnie wejście z UTM albo z innej strony w ciągu 30 dni (lib/attribution.js). Kwoty brutto sprzed rabatu; po rabacie w Stripe. Kampanię wybierz polami „od – do” powyżej.</p>`;
}

module.exports = { render, campaignData, warsawMidnightUtc };
