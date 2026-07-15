const express = require('express');
const { passport, googleConfigured } = require('../lib/auth');

const router = express.Router();

router.get('/auth/google', (req, res, next) => {
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
    if (!googleConfigured) return res.redirect('/admin');
    return passport.authenticate('google', { failureRedirect: '/admin?login=failed' })(req, res, next);
  },
  (req, res) => res.redirect('/admin')
);

router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/baza');
  });
});

module.exports = router;
