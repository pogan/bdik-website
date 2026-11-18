const express = require('express');
const { describeSource, sourceKey } = require('../lib/attribution');
const orders = require('../lib/orders');
const stats = require('../lib/stats');
const { isAdmin } = require('../lib/projection');
const { formatAmount, breakdownFromNet, describeFilters, FORMAT_LABELS } = require('../lib/pricing');
const { ensureBackup } = require('../lib/backup');
const { baseUrl } = require('../lib/stripe');

const router = express.Router();

// Strona logowania administratora. Logowanie w serwisie odbywa się WYŁĄCZNIE tu
// (na stronie głównej nie ma przycisku logowania). Zalogowanego admina od razu
// przenosimy do panelu; zalogowanego bez uprawnień informujemy o braku dostępu.
router.get('/', (req, res) => {
  if (isAdmin(req)) return res.redirect('/admin/orders');
  if (req.user) {
    return res.status(403).render('admin-forbidden', { user: req.user });
  }
  return res.render('admin-login', {
    user: null,
    loginFailed: req.query.login === 'failed',
    previewLogin: require('../lib/preview').enabled,
  });
});

// Pozostałe podstrony panelu są wyłącznie dla administratora (rola 'admin' lub
// e-mail z ADMIN_EMAILS). Dla przeglądarki oddajemy 403 jako stronę, nie JSON.
router.use((req, res, next) => {
  if (!isAdmin(req)) {
    return res.status(403).render('admin-forbidden', { user: req.user || null });
  }
  return next();
});

// Wiersz zamówienia w kształcie dla widoku - identyfikatorem wiodącym jest
// numer transakcji Stripe (pi_...), po nim rozpoznajemy płatność przy reklamacji.
function adminRow(order) {
  const selection = orders.parseSelection(order);
  const state = orders.downloadState(order);
  const downloadId = order.stripe_payment_intent || order.token;
  // order.amount to NETTO; w panelu pokazujemy brutto (kwotę pobraną) z rozbiciem.
  const { net, vat, gross } = breakdownFromNet(order.amount);
  return {
    id: order.id,
    identifier: order.stripe_payment_intent || null,
    token: order.token,
    status: order.status,
    email: order.email || null,
    billingName: order.billing_name || null,
    billingTaxId: order.billing_tax_id || null,
    billingAddress: order.billing_address || null,
    format: order.format,
    formatLabel: FORMAT_LABELS[order.format] || order.format,
    rowCount: order.row_count,
    amountLabel: formatAmount(gross),
    netLabel: formatAmount(net),
    vatLabel: formatAmount(vat),
    description: describeFilters({ ...selection.filters, q: selection.q }),
    createdAt: order.created_at,
    paidAt: order.paid_at,
    downloadCount: order.download_count,
    source: describeSource(order),
    // Link do backupu (dla admina) - zawsze dla opłaconego, także po wygaśnięciu
    // linku klienta. Publiczny link do klienta pokazujemy tylko, gdy wciąż aktywny.
    backupUrl: order.status === 'paid' ? `/admin/orders/${downloadId}/plik` : null,
    publicUrl: state.ok ? `${baseUrl()}/pobierz/${downloadId}` : null,
    publicActive: state.ok,
  };
}

// Filtr statusu w panelu. Kolejność = kolejność przycisków w widoku.
const STATUS_FILTERS = [
  { value: 'paid', label: 'opłacone' },
  { value: 'pending', label: 'oczekuje' },
  { value: 'failed', label: 'nieudane' },
  { value: 'expired', label: 'wygasłe' },
];

// Wysyłamy zawsze wszystkie zamówienia; filtr przełącza widok w przeglądarce
// (public/js/admin-orders.js). ?status= ustala tylko filtr na starcie, żeby
// zakładka i odświeżenie pokazywały ten sam widok.
router.get('/orders', (req, res) => {
  const all = orders.listAll();
  // Nieznana wartość parametru = brak filtra (pokazujemy wszystkie).
  const status = STATUS_FILTERS.some((f) => f.value === req.query.status) ? req.query.status : null;
  const rows = all.map(adminRow);
  const statusFilters = STATUS_FILTERS.map((f) => ({
    ...f,
    count: all.filter((o) => o.status === f.value).length,
  }));
  // Opłacone zamówienia według źródła (kampania / strona odsyłająca), bez
  // zakupów testowych administratora. Kwoty brutto sprzed rabatu - kwotę po
  // kodzie rabatowym widać w Stripe.
  const bySource = new Map();
  for (const o of all) {
    if (o.status !== 'paid' || o.created_by_admin) continue;
    const key = sourceKey(o);
    const agg = bySource.get(key) || { source: key, count: 0, gross: 0 };
    agg.count += 1;
    agg.gross += breakdownFromNet(o.amount).gross;
    bySource.set(key, agg);
  }
  const sourceSummary = [...bySource.values()]
    .sort((a, b) => b.gross - a.gross)
    .map((s) => ({ ...s, grossLabel: formatAmount(s.gross) }));
  res.render('admin-orders', {
    user: req.user || null,
    sourceSummary,
    orders: rows,
    totalCount: all.length,
    status,
    statusFilters,
    ttlHours: orders.DOWNLOAD_TTL_HOURS,
    maxDownloads: orders.MAX_DOWNLOADS,
  });
});

// Statystyki lejka sprzedażowego: kroki od wizyty do opłaconego zamówienia,
// rozkład widzianych wycen, źródła ruchu i przebieg dzienny (lib/stats.js).
router.get('/stats', (req, res) => {
  res.render('admin-stats', {
    user: req.user || null,
    funnel: stats.funnel(),
    funnelSince: stats.funnelSince(),
    quoteBuckets: stats.quoteBuckets(),
    archive: stats.archive(),
    daily: stats.daily(),
    revenue: stats.revenue(),
  });
});

// Pobranie kopii zapasowej przez administratora - BEZ limitu pobrań i BEZ TTL
// (to nie jest link-uprawnienie klienta, tylko dostęp właściciela do backupu).
router.get('/orders/:id/plik', async (req, res, next) => {
  try {
    const order = orders.findByDownloadId(req.params.id);
    if (!order || order.status !== 'paid') {
      return res.status(404).send('Brak opłaconego zamówienia dla tego identyfikatora.');
    }
    const filePath = await ensureBackup(order);
    const name = order.stripe_payment_intent || order.token;
    return res.download(filePath, `backup-${name}.${order.format}`, (err) => {
      if (err && !res.headersSent) next(err);
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
