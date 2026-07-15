-- Składnia przenośna do PostgreSQL (typy, brak AUTOINCREMENT-specyficznych trików poza PK).

CREATE TABLE IF NOT EXISTS raw_seed (
  id INTEGER PRIMARY KEY,
  source_ref TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_rik (
  id INTEGER PRIMARY KEY,
  source_ref TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_gus (
  id INTEGER PRIMARY KEY,
  source_ref TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_krs (
  id INTEGER PRIMARY KEY,
  source_ref TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_ceidg (
  id INTEGER PRIMARY KEY,
  source_ref TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL
);

-- Tabela zunifikowana. REGON jest kluczem naturalnym encji (zawsze TEXT - Excel
-- obcina wiodące zera, jeśli REGON trafi do kolumny liczbowej).
CREATE TABLE IF NOT EXISTS institutions (
  id INTEGER PRIMARY KEY,
  regon TEXT NOT NULL UNIQUE,
  regon_valid INTEGER NOT NULL DEFAULT 0,
  primary_source TEXT NOT NULL DEFAULT 'seed',
  nip TEXT,
  source_ref TEXT,
  krs TEXT,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  legal_form TEXT,
  voivodeship TEXT,
  county TEXT,
  commune TEXT,
  locality TEXT,
  street TEXT,
  building_no TEXT,
  unit_no TEXT,
  postal_code TEXT,
  post_office TEXT,
  phone TEXT,
  phone_normalized TEXT,
  fax TEXT,
  email TEXT,
  website TEXT,
  pkd_main_code TEXT,
  pkd_main_desc TEXT,
  employment_band TEXT,
  activity_start_date TEXT,
  founded_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_institutions_voivodeship ON institutions(voivodeship);
CREATE INDEX IF NOT EXISTS idx_institutions_county ON institutions(county);
CREATE INDEX IF NOT EXISTS idx_institutions_locality ON institutions(locality);
CREATE INDEX IF NOT EXISTS idx_institutions_postal_code ON institutions(postal_code);
CREATE INDEX IF NOT EXISTS idx_institutions_nip ON institutions(nip);

-- Provenance: które źródło dostarczyło / potwierdziło dany rekord.
CREATE TABLE IF NOT EXISTS institution_sources (
  id INTEGER PRIMARY KEY,
  institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  raw_id INTEGER,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(institution_id, source)
);

-- Allowlist użytkowników - istniejący aktywny wiersz = dostęp do pełnych danych.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  google_sub TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'viewer',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- Zamówienia eksportu. filters trzyma komplet kryteriów (JSON) z chwili zakupu -
-- plik do pobrania generujemy WYŁĄCZNIE z tej kolumny, nigdy z parametrów URL,
-- więc kupujący nie podmieni zakresu po zapłaceniu za mniejszy wycinek.
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email TEXT,
  format TEXT NOT NULL,
  filters TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'pln',
  status TEXT NOT NULL DEFAULT 'pending',
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  paid_at TEXT,
  download_count INTEGER NOT NULL DEFAULT 0,
  last_download_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_stripe_session ON orders(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- Stripe dostarcza webhooki "at least once" - ta tabela robi za klucz
-- idempotencji, żeby powtórka tego samego zdarzenia nie liczyła się dwa razy.
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sesje (express-session) - patrz lib/sqliteSessionStore.js. Ten sam silnik
-- (better-sqlite3) co reszta bazy, żeby nie mieszać dwóch sterowników SQLite.
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  expires INTEGER NOT NULL,
  sess TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);

CREATE VIRTUAL TABLE IF NOT EXISTS institutions_fts USING fts5(
  name,
  locality,
  content='institutions',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS institutions_ai AFTER INSERT ON institutions BEGIN
  INSERT INTO institutions_fts(rowid, name, locality) VALUES (new.id, new.name, new.locality);
END;

CREATE TRIGGER IF NOT EXISTS institutions_ad AFTER DELETE ON institutions BEGIN
  INSERT INTO institutions_fts(institutions_fts, rowid, name, locality) VALUES ('delete', old.id, old.name, old.locality);
END;

CREATE TRIGGER IF NOT EXISTS institutions_au AFTER UPDATE ON institutions BEGIN
  INSERT INTO institutions_fts(institutions_fts, rowid, name, locality) VALUES ('delete', old.id, old.name, old.locality);
  INSERT INTO institutions_fts(rowid, name, locality) VALUES (new.id, new.name, new.locality);
END;
