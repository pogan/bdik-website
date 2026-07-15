const express = require('express');
const orders = require('../lib/orders');
const { isAdmin } = require('../lib/projection');
const { formatAmount, breakdownFromNet, describeFilters, FORMAT_LABELS } = require('../lib/pricing');
const { ensureBackup } = require('../lib/backup');
const { baseUrl } = require('../lib/stripe');

const router = express.Router();

// Cały panel jest wyłącznie dla administratora (rola 'admin' lub e-mail z
// ADMIN_EMAILS). Dla przeglądarki oddajemy 403 jako stronę, nie JSON.
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
    // Link do backupu (dla admina) - zawsze dla opłaconego, także po wygaśnięciu
    // linku klienta. Publiczny link do klienta pokazujemy tylko, gdy wciąż aktywny.
    backupUrl: order.status === 'paid' ? `/admin/orders/${downloadId}/plik` : null,
    publicUrl: state.ok ? `${baseUrl()}/pobierz/${downloadId}` : null,
    publicActive: state.ok,
  };
}

router.get('/orders', (req, res) => {
  const rows = orders.listAll().map(adminRow);
  res.render('admin-orders', {
    user: req.user || null,
    orders: rows,
    ttlHours: orders.DOWNLOAD_TTL_HOURS,
    maxDownloads: orders.MAX_DOWNLOADS,
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
