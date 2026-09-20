require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const session = require('express-session');

const db = require('./db');
const SqliteSessionStore = require('./lib/sqliteSessionStore');
const { passport } = require('./lib/auth');
const { isAdmin } = require('./lib/projection');
const { seller } = require('./lib/sellerInfo');
const { TERMS_VERSION } = require('./lib/legal');
const { baseUrl, canonicalUrl } = require('./lib/seo');
const { organizationSchema, websiteSchema } = require('./lib/structuredData');
const { recordVisit } = require('./lib/visits');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payments');
const webhookRoutes = require('./routes/webhooks');
const adminRoutes = require('./routes/admin');
const guidesRoutes = require('./routes/guides');
const { router: pagesRoutes, PUBLIC_PAGES } = require('./routes/pages');

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

// Organization/WebSite i URL obrazka OG są takie same dla każdego żądania -
// liczymy raz przy starcie procesu zamiast w każdym przebiegu middleware.
const ORG_STRUCTURED_DATA = [organizationSchema(), websiteSchema()];
const OG_IMAGE_URL = `${baseUrl()}/images/og-cover.png`;

// Dane wspólne dla wszystkich widoków: flaga admina (link do panelu w nav),
// dane sprzedawcy (stopka), aktualna wersja regulaminu i dane strukturalne
// Organization/WebSite (patrz partials/head.ejs) - te dwa typy schema.org mają
// sens na każdej publicznej stronie, nie tylko tam, gdzie trasa jawnie przekazuje
// `structuredData` (Dataset/FAQPage na /baza itp.).
app.use((req, res, next) => {
  res.locals.isAdmin = isAdmin(req);
  res.locals.seller = seller;
  res.locals.termsVersion = TERMS_VERSION;
  res.locals.orgStructuredData = ORG_STRUCTURED_DATA;
  res.locals.ogImageUrl = OG_IMAGE_URL;
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

// robots.txt / sitemap.xml zbudowane z PUBLIC_PAGES (routes/pages.js) - tej
// samej listy publicznych, indeksowalnych tras co render'y w tamtym pliku,
// żeby dodanie nowej strony publicznej nie wymagało pamiętania o osobnym pliku.
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
      'Disallow: /logout',
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
      `    <lastmod>${page.lastmod}</lastmod>\n` +
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
  // Produkcja: 301 (nie domyślne 302 Expressa) - to strona główna domeny, więc
  // powinna przekazywać pełną wagę SEO na /baza zamiast rozbijać ją między dwa adresy.
  // Dev: 302, bo Chrome trwale cache'uje 301 per-origin (http://localhost:3000)
  // i przekierowanie "zaraża" każdą inną aplikację uruchomioną na tym porcie.
  res.redirect(process.env.NODE_ENV === 'production' ? 301 : 302, '/baza');
});

app.use('/', guidesRoutes);
app.use('/', pagesRoutes);

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
