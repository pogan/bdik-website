// Dodaje adres e-mail do allowlisty logowania Google.
// Użycie: node scripts/add_user.js user@example.com [rola]
require('dotenv').config();
const db = require('../db');

const email = (process.argv[2] || '').trim().toLowerCase();
const role = process.argv[3] || 'viewer';

if (!email || !email.includes('@')) {
  console.error('Użycie: node scripts/add_user.js user@example.com [rola]');
  process.exit(1);
}

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  db.prepare('UPDATE users SET is_active = 1, role = ? WHERE id = ?').run(role, existing.id);
  console.log(`Aktywowano istniejące konto: ${email} (rola: ${role})`);
} else {
  db.prepare('INSERT INTO users (email, role, is_active) VALUES (?, ?, 1)').run(email, role);
  console.log(`Dodano do allowlisty: ${email} (rola: ${role})`);
}
