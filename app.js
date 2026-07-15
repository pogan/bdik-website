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
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payments');
const webhookRoutes = require('./routes/webhooks');
const adminRoutes = require('./routes/admin');

const app = express();

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  contentSecurityPolicy: false, // CDN Bootstrap/Google Fonts - dopracujemy CSP w kolejnym kroku
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

// Flaga administratora dostępna we wszystkich widokach (np. link do panelu w nav).
app.use((req, res, next) => {
  res.locals.isAdmin = isAdmin(req);
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
