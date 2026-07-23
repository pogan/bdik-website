const db = require('../db');

// Prosty format e-maila - dokładność zostawiamy weryfikacji przez faktyczną
// wysyłkę; tu odsiewamy tylko oczywiste śmieci.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const insertLead = db.prepare('INSERT OR IGNORE INTO leads (email, source) VALUES (?, ?)');

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

// Ponowne zgłoszenie tego samego adresu nie jest błędem (INSERT OR IGNORE) -
// wysyłkę próbki i tak ponawiamy, bo klient mógł zgubić poprzednią wiadomość.
function saveLead(email, source = null) {
  insertLead.run(email.trim().toLowerCase(), source);
}

module.exports = { isValidEmail, saveLead };
