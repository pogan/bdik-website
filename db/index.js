const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bdik.sqlite');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// CREATE TABLE IF NOT EXISTS nie dodaje kolumn do już istniejącej tabeli -
// proste migracje dla pól dodanych po pierwszym uruchomieniu.
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('institutions', 'primary_source', "TEXT NOT NULL DEFAULT 'seed'");

// Kolumny dodane wraz z warstwą zgodności prawnej (zgody, e-mail potwierdzający,
// dane do faktury) - dla istniejących produkcyjnych baz, których CREATE TABLE
// IF NOT EXISTS nie zmieni.
ensureColumn('orders', 'terms_version', 'TEXT');
ensureColumn('orders', 'terms_accepted_at', 'TEXT');
ensureColumn('orders', 'withdrawal_consent_at', 'TEXT');
ensureColumn('orders', 'confirmation_email_at', 'TEXT');
ensureColumn('orders', 'billing_name', 'TEXT');
ensureColumn('orders', 'billing_tax_id', 'TEXT');
ensureColumn('orders', 'billing_address', 'TEXT');

// Liczba rekordów płatnych (z danymi kontaktowymi) - wycena "płacisz tylko za
// rekordy z kontaktem"; NULL w zamówieniach sprzed tej zmiany.
ensureColumn('orders', 'billed_count', 'INTEGER');

// Źródło pierwszej wizyty (referrer/UTM/strona wejścia) - patrz lib/visits.js.
ensureColumn('visits', 'referrer', 'TEXT');
ensureColumn('visits', 'utm_source', 'TEXT');
ensureColumn('visits', 'utm_medium', 'TEXT');
ensureColumn('visits', 'utm_campaign', 'TEXT');
ensureColumn('visits', 'landing_path', 'TEXT');

module.exports = db;
