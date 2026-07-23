require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const session = require('express-session');

const db = require('./db');
const SqliteSessionStore = require('./lib/sqliteSessionStore');
const { passport } = require('./lib/auth');
const { publishableKey, stripeConfigured } = require('./lib/stripe');
const { isAdmin } = require('./lib/projection');
const { adminViewSpec } = require('./lib/adminTable');
const { seller } = require('./lib/sellerInfo');
const { lastDataUpdate } = require('./lib/dataFreshness');
const { TERMS_VERSION, isKnownTermsVersion, termsViewName } = require('./lib/legal');
const { baseUrl, canonicalUrl } = require('./lib/seo');
const { recordVisit } = require('./lib/visits');
const { TIERS, MIN_AMOUNT, priceBreakdown, breakdownFromNet, formatAmount } = require('./lib/pricing');
const { countInstitutions, countWithContact } = require('./lib/query');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payments');
const webhookRoutes = require('./routes/webhooks');
const adminRoutes = require('./routes/admin');

const app = express();

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Zasoby front-endu są już self-hostowane (public/vendor), więc CSP nie musi
// dopuszczać CDN. CSP zostaje jednak WYŁĄCZONE do czasu testu z żywym Stripe:
// osadzony Checkout ładuje js.stripe.com i ramki checkout.stripe.com, a strona ma
// też inline'owy <script> (window.BDIK_STRIPE) - włączenie błędnej polityki psuje
// płatności. Docelowa polityka do włączenia po weryfikacji płatności na produkcji:
//   directives: {
//     defaultSrc: ["'self'"],
//     scriptSrc: ["'self'", "'unsafe-inline'", 'https://js.stripe.com'],
//     frameSrc: ['https://js.stripe.com', 'https://checkout.stripe.com'],
//     connectSrc: ["'self'", 'https://api.stripe.com'],
//     imgSrc: ["'self'", 'data:', 'https:'],
//   }
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(compression());
app.use(express.static(path.join(__dirname, 'public')));

// Webhook Stripe przed jakimkolwiek parserem JSON i przed sesją: weryfikacja
// podpisu wymaga surowego body, a samo zdarzenie nie ma nic wspólnego z sesją
// przeglądarki użytkownika.
app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

app.use(
  session({
    store: new SqliteSessionStore(db),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Dane wspólne dla wszystkich widoków: flaga admina (link do panelu w nav),
// dane sprzedawcy (stopka) i aktualna wersja regulaminu.
app.use((req, res, next) => {
  res.locals.isAdmin = isAdmin(req);
  res.locals.seller = seller;
  res.locals.termsVersion = TERMS_VERSION;
  next();
});

// Licznik odwiedzin: tylko realne wejścia na strony (GET, poza API, panelem
// admina i logowaniem), żeby wywołania AJAX-owe i callbacki OAuth nie zawyżały
// liczby. Własne wejścia admina też pomijamy - inaczej statystyka mierzyłaby
// głównie pracę nad serwisem (to samo dla zdarzeń, patrz routes/api.js).
// Przy pierwszej wizycie zapisujemy też źródło (referrer + parametry utm_* z
// linków wrzucanych w social media) i stronę wejścia - patrz /admin/stats.
app.use((req, res, next) => {
  if (
    req.method === 'GET' &&
    !res.locals.isAdmin &&
    req.path !== '/healthz' &&
    !req.path.startsWith('/api') &&
    !req.path.startsWith('/admin') &&
    !req.path.startsWith('/auth')
  ) {
    recordVisit(req.ip, {
      referrer: req.get('referer'),
      utmSource: typeof req.query.utm_source === 'string' ? req.query.utm_source : null,
      utmMedium: typeof req.query.utm_medium === 'string' ? req.query.utm_medium : null,
      utmCampaign: typeof req.query.utm_campaign === 'string' ? req.query.utm_campaign : null,
      landingPath: req.path,
    });
  }
  next();
});

app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

// robots.txt / sitemap.xml zbudowane z tej samej listy publicznych,
// indeksowalnych tras co render'y poniżej - trzymamy je razem, żeby dodanie
// nowej strony publicznej nie wymagało pamiętania o osobnym pliku.
const PUBLIC_PAGES = [
  { path: '/baza', changefreq: 'daily', priority: '1.0' },
  { path: '/regulamin', changefreq: 'monthly', priority: '0.3' },
  { path: '/polityka-prywatnosci', changefreq: 'monthly', priority: '0.3' },
];

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /platnosc',
      'Disallow: /pobierz',
      'Disallow: /api',
      'Disallow: /auth',
      '',
      `Sitemap: ${baseUrl()}/sitemap.xml`,
      '',
    ].join('\n')
  );
});

app.get('/sitemap.xml', (req, res) => {
  const urls = PUBLIC_PAGES.map(
    (page) =>
      `  <url>\n` +
      `    <loc>${canonicalUrl(page.path)}</loc>\n` +
      `    <changefreq>${page.changefreq}</changefreq>\n` +
      `    <priority>${page.priority}</priority>\n` +
      `  </url>`
  ).join('\n');
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
});

app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);
app.use('/', authRoutes);
app.use('/', paymentRoutes);

app.get('/', (req, res) => {
  // 301 (nie domyślne 302 Expressa): to strona główna domeny, więc powinna
  // przekazywać pełną wagę SEO na /baza zamiast rozbijać ją między dwa adresy.
  res.redirect(301, '/baza');
});

// Sekcja #cennik na stronie bazy renderuje się z tych samych stałych, którymi
// serwer faktycznie wycenia eksport (lib/pricing.js) - cennik nie może się
// rozjechać z pobieraną kwotą. Przykłady liczone priceBreakdown, kwoty brutto.
function cennikView() {
  const example = (label, note, rows) => {
    const bd = priceBreakdown(rows);
    return { label, note, rows, grossLabel: formatAmount(bd.gross) };
  };
  // Płatne są tylko rekordy z danymi kontaktowymi (patrz routes/payments.js),
  // więc przykład "cała baza" wycenia rekordy z kontaktem, nie wszystkie wiersze.
  const totalRows = countInstitutions(db);
  const billableRows = countWithContact(db);
  return {
    tiers: TIERS.map((t, i) => ({
      from: i === 0 ? 1 : TIERS[i - 1].upTo + 1,
      upTo: t.upTo === Infinity ? null : t.upTo,
      perRowLabel: formatAmount(t.perRow),
    })),
    minGrossLabel: formatAmount(breakdownFromNet(MIN_AMOUNT).gross),
    examples: [
      example('Jedna miejscowość', 'np. wybrane miasto, ok. 25 rekordów z kontaktem', 25),
      example('Całe województwo', 'ok. 150 rekordów z kontaktem', 150),
      example('Cała baza', `${totalRows} instytucji, płatne ${billableRows} z kontaktem`, billableRows),
    ],
  };
}

app.get('/baza', (req, res) => {
  const description =
    'Baza ponad 2 200 domów kultury, bibliotek i centrów kultury w Polsce. ' +
    'Filtruj po województwie, powiecie, gminie i miejscowości, sprawdź dane ' +
    'kontaktowe i wyeksportuj listę do CSV, XLSX lub PDF.';
  res.render('baza', {
    cennik: cennikView(),
    user: req.user || null,
    stripePublishableKey: publishableKey,
    stripeConfigured,
    // Rozszerzony widok (wszystkie kolumny + filtr na każdej z nich) dostaje
    // wyłącznie administrator; dla reszty spec jest pusty, więc tabela zostaje
    // taka jak dotąd.
    adminView: isAdmin(req) ? adminViewSpec() : null,
    dataUpdatedAt: lastDataUpdate(),
    title: 'Baza Danych Instytucji Kultury — kontakty do domów kultury i bibliotek',
    description,
    robots: 'index, follow',
    canonicalUrl: canonicalUrl('/baza'),
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'Dataset',
      name: 'Baza Danych Instytucji Kultury',
      description,
      url: canonicalUrl('/baza'),
      license: canonicalUrl('/regulamin'),
      isAccessibleForFree: false,
      keywords: ['domy kultury', 'biblioteki', 'centra kultury', 'instytucje kultury', 'kontakty'],
      creator: {
        '@type': 'Organization',
        name: seller.name,
        email: seller.email,
        url: baseUrl(),
      },
    },
  });
});

// Strony prawne. Regulamin obowiązujący pod /regulamin; konkretną (także
// archiwalną) wersję pod /regulamin/:wersja - potrzebne, bo e-mail potwierdzający
// linkuje do wersji z chwili zakupu (orders.terms_version). Wszystkie wersje
// canonicalizują na /regulamin, żeby archiwalne treści (niemal identyczne)
// nie konkurowały ze sobą o indeksację jako duplikaty.
app.get('/regulamin', (req, res) => {
  res.render('legal', {
    user: req.user || null,
    document: termsViewName(TERMS_VERSION),
    documentVersion: TERMS_VERSION,
    title: 'Regulamin — Baza Danych Instytucji Kultury',
    description: 'Regulamin świadczenia usług i sprzedaży eksportów danych w serwisie Baza Danych Instytucji Kultury.',
    robots: 'index, follow',
    canonicalUrl: canonicalUrl('/regulamin'),
  });
});

app.get('/regulamin/:wersja', (req, res) => {
  if (!isKnownTermsVersion(req.params.wersja)) {
    return res.status(404).send('Nie znaleziono tej wersji regulaminu.');
  }
  return res.render('legal', {
    user: req.user || null,
    document: termsViewName(req.params.wersja),
    documentVersion: req.params.wersja,
    title: `Regulamin (wersja z ${req.params.wersja}) — Baza Danych Instytucji Kultury`,
    description: 'Archiwalna wersja regulaminu serwisu Baza Danych Instytucji Kultury.',
    robots: 'index, follow',
    canonicalUrl: canonicalUrl('/regulamin'),
  });
});

app.get('/polityka-prywatnosci', (req, res) => {
  res.render('legal', {
    user: req.user || null,
    document: 'legal/polityka-prywatnosci',
    documentVersion: null,
    title: 'Polityka prywatności — Baza Danych Instytucji Kultury',
    description: 'Polityka prywatności i informacje o plikach cookies w serwisie Baza Danych Instytucji Kultury.',
    robots: 'index, follow',
    canonicalUrl: canonicalUrl('/polityka-prywatnosci'),
  });
});

app.use((req, res) => {
  res.status(404).render('404', { user: req.user || null });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: 'Wystąpił błąd serwera.' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`bdik-website nasłuchuje na porcie ${PORT}`);
  });
}

module.exports = app;
