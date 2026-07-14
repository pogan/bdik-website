require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const session = require('express-session');

const db = require('./db');
const SqliteSessionStore = require('./lib/sqliteSessionStore');
const { passport } = require('./lib/auth');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');

const app = express();

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  contentSecurityPolicy: false, // CDN Bootstrap/Google Fonts - dopracujemy CSP w kolejnym kroku
}));
app.use(compression());
app.use(express.static(path.join(__dirname, 'public')));

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

app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

app.use('/api', apiRoutes);
app.use('/', authRoutes);

app.get('/', (req, res) => {
  res.redirect('/baza');
});

app.get('/baza', (req, res) => {
  res.render('baza', { user: req.user || null });
});

app.use((req, res) => {
  res.status(404).send('Nie znaleziono');
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`bdik-website nasłuchuje na porcie ${PORT}`);
  });
}

module.exports = app;
