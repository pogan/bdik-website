const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('../db');

const findUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const findUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const updateLogin = db.prepare("UPDATE users SET google_sub = ?, last_login_at = datetime('now') WHERE id = ?");

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = findUserById.get(id);
  done(null, user || false);
});

const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

if (googleConfigured) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
      },
      (accessToken, refreshToken, profile, done) => {
        const email = ((profile.emails && profile.emails[0] && profile.emails[0].value) || '').toLowerCase();
        const user = email ? findUserByEmail.get(email) : null;

        // Model allowlisty: konto musi już istnieć w tabeli users (dodane
        // ręcznie przez admina, patrz scripts/add_user.js) i być aktywne.
        // Logowanie Google NIE tworzy nowych kont automatycznie.
        if (!user || !user.is_active) {
          return done(null, false, { message: 'Konto nie ma dostępu. Skontaktuj się z administratorem.' });
        }

        updateLogin.run(profile.id, user.id);
        return done(null, user);
      }
    )
  );
}

module.exports = { passport, googleConfigured };
