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
const { seller } = require('./lib/sellerInfo');
const { TERMS_VERSION, isKnownTermsVersion, termsViewName } = require('./lib/legal');
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

app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);
app.use('/', authRoutes);
app.use('/', paymentRoutes);

app.get('/', (req, res) => {
  res.redirect('/baza');
});

app.get('/baza', (req, res) => {
  res.render('baza', {
    user: req.user || null,
    stripePublishableKey: publishableKey,
    stripeConfigured,
  });
});

// Strony prawne. Regulamin obowiązujący pod /regulamin; konkretną (także
// archiwalną) wersję pod /regulamin/:wersja - potrzebne, bo e-mail potwierdzający
// linkuje do wersji z chwili zakupu (orders.terms_version).
app.get('/regulamin', (req, res) => {
  res.render('legal', {
    user: req.user || null,
    document: termsViewName(TERMS_VERSION),
    documentVersion: TERMS_VERSION,
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
  });
});

app.get('/polityka-prywatnosci', (req, res) => {
  res.render('legal', {
    user: req.user || null,
    document: 'legal/polityka-prywatnosci',
    documentVersion: null,
  });
});

app.use((req, res) => {
  res.status(404).send('Nie znaleziono');
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
