const express = require('express');
const db = require('../db');
const { passport, googleConfigured } = require('../lib/auth');
const preview = require('../lib/preview');

const router = express.Router();

router.get('/auth/google', (req, res, next) => {
  // Podgląd dla klienta: logowanie zawsze się udaje, bez Google (lib/preview.js).
  if (preview.enabled) {
    return req.logIn(preview.previewUser(db), (err) => (err ? next(err) : res.redirect('/kierownik')));
  }
  if (!googleConfigured) {
    return res
      .status(503)
      .send('Logowanie Google nie jest skonfigurowane. Ustaw GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET w .env.');
  }
  return passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get(
  '/auth/google/callback',
  (req, res, next) => {
    if (!googleConfigured || preview.enabled) return res.redirect('/kierownik');
    return passport.authenticate('google', { failureRedirect: '/kierownik?login=failed' })(req, res, next);
  },
  (req, res) => res.redirect('/kierownik')
);

router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/baza');
  });
});

module.exports = router;
