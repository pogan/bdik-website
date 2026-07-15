const crypto = require('crypto');
const db = require('../db');

const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'];

// Link do pobrania jest linkiem-uprawnieniem (capability URL): sam identyfikator
// wystarcza, żeby pobrać plik, więc musi być nieodgadywalny, wygasać i mieć limit
// użyć. Publiczny link budujemy z identyfikatora transakcji Stripe (pi_...), który
// jest zarazem numerem do reklamacji - patrz routes/payments.js i routes/admin.js.
const DOWNLOAD_TTL_HOURS = 24;
const MAX_DOWNLOADS = 10;

const FILTER_KEYS = ['voivodeship', 'county', 'commune', 'locality', 'postal_code', 'legal_form'];

const insertOrder = db.prepare(`
  INSERT INTO orders (
    token, user_id, email, format, filters, row_count, amount, currency, status,
    terms_version, terms_accepted_at, withdrawal_consent_at
  )
  VALUES (
    @token, @user_id, @email, @format, @filters, @row_count, @amount, @currency, 'pending',
    @terms_version, datetime('now'), datetime('now')
  )
`);
const selectByToken = db.prepare('SELECT * FROM orders WHERE token = ?');
const selectBySession = db.prepare('SELECT * FROM orders WHERE stripe_session_id = ?');
const selectByIntent = db.prepare('SELECT * FROM orders WHERE stripe_payment_intent = ? ORDER BY id DESC LIMIT 1');
const selectAll = db.prepare('SELECT * FROM orders ORDER BY id DESC');
const setSession = db.prepare('UPDATE orders SET stripe_session_id = ? WHERE id = ?');
const setPaid = db.prepare(`
  UPDATE orders
  SET status = 'paid', paid_at = datetime('now'), stripe_payment_intent = COALESCE(@payment_intent, stripe_payment_intent),
      email = COALESCE(@email, email)
  WHERE id = @id AND status <> 'paid'
`);
const setStatus = db.prepare('UPDATE orders SET status = ? WHERE id = ? AND status <> \'paid\'');
const bumpDownload = db.prepare(`
  UPDATE orders SET download_count = download_count + 1, last_download_at = datetime('now') WHERE id = ?
`);
// Atomowe "zajęcie" wysyłki e-maila: ustawia znacznik tylko, jeśli jeszcze go nie
// było. Dzięki temu wyścig webhooka i synchronizacji ze Stripe nie wyśle dwóch
// potwierdzeń - wysyła ten, kto pierwszy dostał changes > 0.
const claimEmail = db.prepare(`
  UPDATE orders SET confirmation_email_at = datetime('now')
  WHERE id = ? AND confirmation_email_at IS NULL
`);
const setBilling = db.prepare(`
  UPDATE orders SET
    billing_name = COALESCE(@name, billing_name),
    billing_tax_id = COALESCE(@tax_id, billing_tax_id),
    billing_address = COALESCE(@address, billing_address)
  WHERE id = @id
`);
const insertEvent = db.prepare('INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?, ?)');

// Twarda walidacja zgód po stronie serwera - niezależna od checkboxów w UI.
// Wymaga literalnego true (nie "true" ze spreparowanego żądania), żeby nie dało
// się kupić bez świadomego oświadczenia.
function validateConsents(body = {}) {
  if (body.termsAccepted !== true) {
    return { ok: false, error: 'Aby kupić eksport, zaakceptuj Regulamin i Politykę prywatności.' };
  }
  if (body.withdrawalConsent !== true) {
    return {
      ok: false,
      error:
        'Aby otrzymać plik od razu, potwierdź żądanie natychmiastowego dostarczenia treści ' +
        'cyfrowej oraz przyjęcie do wiadomości utraty prawa odstąpienia.',
    };
  }
  return { ok: true };
}

// Normalizuje kryteria do jednego kształtu zapisywanego w orders.filters.
// Wszystko, co wpływa na zawartość pliku, musi tu wylądować - to jedyne źródło
// prawdy przy generowaniu eksportu po opłaceniu.
function normalizeSelection(input = {}) {
  const filters = {};
  for (const key of FILTER_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) filters[key] = value.trim();
  }
  const q = typeof input.q === 'string' ? input.q.trim() : '';
  return {
    filters,
    q,
    sort: typeof input.sort === 'string' ? input.sort : 'name',
    order: input.order === 'desc' ? 'desc' : 'asc',
  };
}

function createOrder({ userId = null, email = null, format, selection, rowCount, amount, currency, termsVersion = null }) {
  const token = crypto.randomBytes(24).toString('hex');
  insertOrder.run({
    token,
    user_id: userId,
    email,
    format,
    filters: JSON.stringify(selection),
    row_count: rowCount,
    amount,
    currency,
    terms_version: termsVersion,
  });
  return selectByToken.get(token);
}

function findByToken(token) {
  return typeof token === 'string' && /^[a-f0-9]{48}$/.test(token) ? selectByToken.get(token) : undefined;
}

// Identyfikator transakcji Stripe (pi_...) - używany w publicznym linku do
// pobrania i jako numer reklamacyjny. Istnieje dopiero po opłaceniu.
function findByPaymentIntent(paymentIntent) {
  return typeof paymentIntent === 'string' && /^pi_[A-Za-z0-9]+$/.test(paymentIntent)
    ? selectByIntent.get(paymentIntent)
    : undefined;
}

// Publiczny link pobrania budujemy z pi_..., ale stare linki (sam token) mają
// nadal działać - dlatego akceptujemy oba kształty identyfikatora.
function findByDownloadId(id) {
  return findByToken(id) || findByPaymentIntent(id);
}

function listAll() {
  return selectAll.all();
}

function findBySessionId(sessionId) {
  return sessionId ? selectBySession.get(sessionId) : undefined;
}

function attachSession(orderId, sessionId) {
  setSession.run(sessionId, orderId);
}

function markPaid(order, { paymentIntent = null, email = null } = {}) {
  setPaid.run({ id: order.id, payment_intent: paymentIntent, email });
  return selectByToken.get(order.token);
}

// 'paid' jest stanem końcowym - spóźniony webhook o wygaśnięciu sesji nie może
// odebrać dostępu do już opłaconego pliku (stąd warunek w setStatus).
function markStatus(order, status) {
  setStatus.run(status, order.id);
  return selectByToken.get(order.token);
}

function parseSelection(order) {
  const parsed = JSON.parse(order.filters);
  return normalizeSelection({ ...parsed.filters, q: parsed.q, sort: parsed.sort, order: parsed.order });
}

function downloadState(order) {
  if (!order) return { ok: false, reason: 'not_found' };
  if (order.status !== 'paid') return { ok: false, reason: 'unpaid' };

  const paidAt = Date.parse(`${order.paid_at.replace(' ', 'T')}Z`);
  const expiresAt = paidAt + DOWNLOAD_TTL_HOURS * 60 * 60 * 1000;
  if (Date.now() > expiresAt) return { ok: false, reason: 'expired' };
  if (order.download_count >= MAX_DOWNLOADS) return { ok: false, reason: 'limit' };

  return { ok: true, expiresAt, downloadsLeft: MAX_DOWNLOADS - order.download_count };
}

function registerDownload(order) {
  bumpDownload.run(order.id);
}

// Zwraca true tylko dla tego wywołania, które faktycznie ustawiło znacznik -
// gwarantuje pojedynczą wysyłkę e-maila potwierdzającego.
function claimConfirmationEmail(order) {
  return claimEmail.run(order.id).changes > 0;
}

// Zapisuje dane do faktury pobrane ze Stripe (NIP, nazwa, adres nabywcy).
function saveBilling(order, { name = null, taxId = null, address = null } = {}) {
  setBilling.run({ id: order.id, name, tax_id: taxId, address });
  return selectByToken.get(order.token);
}

// true = zdarzenie widzimy pierwszy raz i należy je przetworzyć.
function rememberEvent(id, type) {
  return insertEvent.run(id, type).changes > 0;
}

module.exports = {
  EXPORT_FORMATS,
  DOWNLOAD_TTL_HOURS,
  MAX_DOWNLOADS,
  normalizeSelection,
  validateConsents,
  createOrder,
  findByToken,
  findByPaymentIntent,
  findByDownloadId,
  listAll,
  findBySessionId,
  attachSession,
  markPaid,
  markStatus,
  parseSelection,
  downloadState,
  registerDownload,
  claimConfirmationEmail,
  saveBilling,
  rememberEvent,
};
