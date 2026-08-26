# BDIK — Baza Danych Instytucji Kultury

A commercial Node/Express web app that sells structured contact-data exports of
Polish cultural institutions (theatres, libraries, museums, community culture
centres, etc.), searchable and filterable by voivodeship (województwo), county,
commune and institution type. The audience is artists, bands, event organisers
and cultural animators who need a reliable, up-to-date way to reach hundreds of
institutions at once instead of hand-collecting contact details.

Browsing and basic identification (name, voivodeship, locality) are free. Full
contact data (phone, e-mail, website, REGON/NIP) requires a Google-login
allowlist account. A paid CSV/XLSX/PDF export is gated behind Stripe Checkout.
This is a real payments product — it moves real money, issues data customers
have paid for, and has to be *correct*, not just functional: webhook events
must be idempotent, VAT has to be broken out and reported correctly, and a
paid file must survive being generated exactly once and being downloadable
again if something fails midway. The design choices below are driven by that,
not by generic CRUD-app conventions.

## Why this project, technically

This isn't a toy CRUD app with a payment button bolted on. It's a small
end-to-end system with several components that each have a specific job:

- an **ETL pipeline** (`etl/`, `sources/`) that ingests institution data from
  multiple sources with different trust levels, deduplicates on REGON as the
  natural key, and merges records by source priority (GUS > RIK > KRS > CEIDG
  > seed) instead of blind overwrite;
- a **field-gating layer** (`lib/projection.js`) that decides, at the SQL
  column-selection level (not by filtering an already-fetched object), which
  fields a given caller is allowed to see — so paid/contact data never leaves
  the database for an unauthorized request in the first place;
- a **pricing and payments layer** (Stripe Checkout + webhooks) where the
  server is the sole source of truth for price and content, so nothing a
  browser sends is ever trusted for money or data selection;
- a **durable-delivery layer** (`lib/backup.js`) that guarantees a paid
  customer's file survives beyond the original download link.

## Payments: how it works, and why

1. `POST /api/checkout/quote` — price quote. Row count comes from the
   database (`countInstitutions`), price from `lib/pricing.js` (tiered, like
   tax brackets: the more records, the cheaper each additional one). The
   amount charged is **never** taken from the browser.
2. `POST /api/checkout` — creates a `pending` order row and a Stripe Checkout
   Session with an inline `price_data` line item (no pre-defined Stripe
   products). The complete filter/selection criteria are persisted as JSON in
   `orders.filters` at this point — this is what actually gets exported later,
   never the URL query string the browser happens to send.
3. `POST /webhooks/stripe` — the source of truth for payment state. Mounted
   **before** `express.json()`, using `express.raw()`, because Stripe's
   signature is an HMAC over the raw request body — a body that's been parsed
   and re-serialized produces different bytes and fails verification.
   Stripe delivers webhook events "at least once", so a `stripe_events` table
   keyed on the event id makes processing idempotent: a redelivered event is
   acknowledged with 200 but not reprocessed.
4. `GET /platnosc?session_id=...` — the return page. BLIK and bank transfers
   can settle asynchronously, so this page both polls order status and
   actively re-syncs from Stripe (`syncOrderFromStripe`) in case the webhook
   hasn't landed yet.
5. `GET /pobierz/:token` — the actual gate. The file is generated from the
   **criteria stored on the order at purchase time**, never from URL
   parameters, so a buyer can't widen the scope of what they paid for after
   the fact. The link expires after 7 days and is capped at a fixed number of
   downloads.

**VAT**: prices in `lib/pricing.js` are net; a Stripe `TaxRate` object (23%,
Poland) is created once and reused (looked up by metadata marker, since
Stripe tax rates can't be deleted, only deactivated), so the customer sees a
proper net/VAT/gross breakdown on the Checkout page and receipt rather than a
single opaque total.

**Backup durability** (`lib/backup.js`): as soon as `markPaid` fires, the
export file for that order is generated once and written to a private,
non-`public/`-served directory, named after the Stripe PaymentIntent id (the
same id used as the customer-facing download link and the complaint/refund
reference). Regeneration is idempotent — if the file already exists,
subsequent calls are a no-op — so a customer's paid file exists independent
of the original download link's 7-day TTL/10-download cap, and independent of
whether the original generation happened synchronously or was retried later.
The write happens "fire and forget" right after webhook processing so a slow
export never risks delaying Stripe's 200 response (which would trigger
needless webhook retries).

## Auth: Google OAuth + allowlist, not self-signup

Login is Google OAuth (Passport) but deliberately **does not create accounts**.
An email has to already exist in the `users` table (added by an operator via
`scripts/add_user.js`) and be active before Google sign-in will succeed — this
keeps "who can see contact-level data" as an explicit, auditable allowlist
rather than open registration. Admin authorization (`lib/projection.js`,
enforced again in `routes/admin.js`) is a double gate: a `role = 'admin'` row
in the database, OR an email present in the `ADMIN_EMAILS` env var — the
latter exists as a safety net so the operator retains admin access even if a
database row's role gets misconfigured. `/admin/orders` and the admin file
route are hard-gated behind this check for every request, not just the initial
page load.

## Data model

SQLite (via `better-sqlite3`) with a schema (`db/schema.sql`) built around a
single `institutions` table keyed on REGON, an `institution_optouts` table
that implements GDPR Art. 21 right-to-object without letting the next ETL run
silently reinstate an opted-out record, an `orders` table that is the single
source of truth for what a buyer paid for and received, and a `stripe_events`
table used purely for webhook idempotency. Visit/event tracking hashes IP
addresses (SHA-256) rather than storing them raw.

## Data enrichment agent

`scripts/enrich_contacts.js` (`lib/enrich.js`) is a multi-phase pipeline that
fills in missing/stale contact data for institutions that don't yet have a
verified phone, e-mail or website: it re-checks existing URLs (repairing
truncated sub-pages/subdomains), derives a likely website from an e-mail
domain, scrapes an institution's own site and its "contact" sub-pages, and
falls back to a search-engine lookup for records still missing data. Because
this runs unattended against arbitrary third-party sites, accepting a new
domain (a truncated subdomain, a search result, a redirect target) requires
independent confirmation — locality/postal code match *and* a second
identifier (a known phone, e-mail, street, or a distinctive name fragment) —
because locality alone is too weak a signal (a city's own portal will always
mention the city). It also decodes common e-mail obfuscation patterns
(Cloudflare email-protection, `[at]`-style munging) and keeps an attempt log
so an interrupted or search-rate-limited run resumes instead of restarting.

## Tech stack

- **Runtime**: Node.js 20+, Express 5
- **Data**: SQLite (`better-sqlite3`), FTS5 for search, `express-session`
  backed by a custom SQLite session store
- **Auth**: Passport + `passport-google-oauth20`, DB-backed allowlist
- **Payments**: Stripe (Checkout Sessions, webhooks, dynamic Tax Rates)
- **Exports**: CSV, XLSX (`exceljs`), PDF (`pdfkit`)
- **Email**: Nodemailer/SMTP for durable-medium purchase confirmations
- **Views**: EJS + Bootstrap 5
- **Hardening**: Helmet, `express-rate-limit`
- **Process management**: PM2 (`ecosystem.config.js`)

## Setup

```bash
npm install
cp .env.example .env
# fill in at minimum SESSION_SECRET; Google/Stripe/SMTP are optional for local
# browsing — the app boots without them and simply returns 503 on the routes
# that need them (login, checkout, webhooks)
```

Load sample institution data and run the test suite:

```bash
npm run etl     # loads + dedups institution records into data/bdik.sqlite
npm test        # normalization, dedup/priority, field-gating, pricing,
                # order lifecycle and webhook idempotency
```

Run locally:

```bash
npm run dev     # node --watch
```

### Local Stripe webhook testing

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

Copy the `whsec_...` value it prints into `STRIPE_WEBHOOK_SECRET`.

### Deployment

Process management via PM2:

```bash
pm2 start ecosystem.config.js
pm2 save
```

Behind an nginx reverse proxy with TLS; the app sets `trust proxy` and
`secure` session cookies in `NODE_ENV=production`, which requires nginx to
forward `X-Forwarded-Proto`.

## Project structure

```
app.js                  Express entry point
db/schema.sql            SQLite schema (institutions, raw_*, users, orders, sessions...)
etl/                     normalization, dedup, ETL orchestration
sources/                 per-source ingestion modules (real seed + registry mocks)
lib/                     field-gating (projection), query/filter/sort, export
                         formats, pricing, orders, Stripe integration, auth, sessions,
                         export backups
routes/                  api.js, auth.js (Google OAuth), payments.js (checkout/
                         status/download), webhooks.js (Stripe), admin.js
views/, public/          EJS + Bootstrap 5 + Bootstrap Icons
scripts/add_user.js      add an email to the login allowlist
```

## Known MVP limitations

- No self-service registration — access to contact-level fields is controlled
  entirely by the `users` allowlist; export purchases are gated by Stripe.
- No confirmation email with a re-issuable download link at present — the
  download link lives on the Stripe return page (`/platnosc`); the admin
  backup path (`/admin/orders/:id/plik`) exists specifically as the fallback
  when a customer needs their file re-delivered.
- Institution "type" as a first-class filter isn't implemented yet — the
  underlying PKD classification data is already present in the schema and
  exports, so adding it later doesn't require re-running the ETL.
