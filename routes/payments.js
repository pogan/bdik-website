const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const orders = require('../lib/orders');
const { countInstitutions } = require('../lib/query');
const { priceFor, formatAmount, lineItemName, describeFilters, CURRENCY, FORMAT_LABELS } = require('../lib/pricing');
const { stripe, stripeConfigured, baseUrl } = require('../lib/stripe');
const { streamExport } = require('../lib/exportRun');

const router = express.Router();

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zbyt wiele prób płatności. Spróbuj ponownie za kilka minut.' },
});

function requireStripe(req, res, next) {
  if (!stripeConfigured) {
    return res.status(503).json({ error: 'Płatności nie są skonfigurowane. Ustaw klucze STRIPE_* w .env.' });
  }
  return next();
}

// Stan zamówienia w kształcie, jakiego oczekuje frontend (public/js/checkout.js).
function orderPayload(order) {
  const selection = orders.parseSelection(order);
  const state = orders.downloadState(order);
  const downloadPath = `/pobierz/${order.token}`;
  return {
    token: order.token,
    status: order.status,
    format: order.format,
    formatLabel: FORMAT_LABELS[order.format] || order.format,
    rowCount: order.row_count,
    amount: order.amount,
    amountLabel: formatAmount(order.amount),
    description: describeFilters({ ...selection.filters, q: selection.q }),
    paymentIntent: order.stripe_payment_intent || null,
    downloadUrl: state.ok ? downloadPath : null,
    // Pełny adres do skopiowania przez klienta (działa poza sesją w przeglądarce).
    downloadUrlAbsolute: state.ok ? `${baseUrl()}${downloadPath}` : null,
    downloadsLeft: state.ok ? state.downloadsLeft : 0,
    reason: state.ok ? null : state.reason,
  };
}

// Webhook jest źródłem prawdy, ale bywa opóźniony (albo nie dojdzie w devie bez
// `stripe listen`). Przy odpytywaniu o status dociągamy stan wprost ze Stripe,
// żeby klient nie utknął na "oczekiwanie" przy już opłaconym zamówieniu.
async function syncOrderFromStripe(order) {
  if (order.status !== 'pending' || !order.stripe_session_id || !stripe) return order;

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
  } catch (err) {
    console.error('Stripe: nie udało się pobrać sesji', order.stripe_session_id, err.message);
    return order;
  }

  if (session.payment_status === 'paid') {
    return orders.markPaid(order, {
      paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      email: session.customer_details ? session.customer_details.email : null,
    });
  }
  if (session.status === 'expired') {
    return orders.markStatus(order, 'expired');
  }
  return order;
}

// Wycena bez zakładania zamówienia - modal pokazuje kwotę, zanim klient
// zdecyduje się płacić.
router.post('/api/checkout/quote', express.json(), (req, res) => {
  const format = String(req.body.format || '').toLowerCase();
  if (!orders.EXPORT_FORMATS.includes(format)) {
    return res.status(400).json({ error: 'Nieobsługiwany format. Dozwolone: csv, xlsx, pdf.' });
  }

  const selection = orders.normalizeSelection(req.body);
  const rowCount = countInstitutions(db, { filters: selection.filters, search: selection.q });
  const amount = priceFor(rowCount);

  return res.json({
    format,
    formatLabel: FORMAT_LABELS[format],
    rowCount,
    amount,
    amountLabel: formatAmount(amount),
    description: describeFilters({ ...selection.filters, q: selection.q }),
  });
});

// Zakłada zamówienie i sesję Stripe Checkout (embedded - płatność dzieje się
// w modalu, bez wychodzenia ze strony).
router.post('/api/checkout', checkoutLimiter, express.json(), requireStripe, async (req, res, next) => {
  try {
    const format = String(req.body.format || '').toLowerCase();
    if (!orders.EXPORT_FORMATS.includes(format)) {
      return res.status(400).json({ error: 'Nieobsługiwany format. Dozwolone: csv, xlsx, pdf.' });
    }

    const selection = orders.normalizeSelection(req.body);

    // Liczba rekordów i cena liczone TYLKO tutaj, z bazy - cokolwiek przysłał
    // frontend jako kwotę, jest ignorowane.
    const rowCount = countInstitutions(db, { filters: selection.filters, search: selection.q });
    if (rowCount === 0) {
      return res.status(400).json({ error: 'Wybrane filtry nie zwracają żadnych instytucji - nie ma czego eksportować.' });
    }
    const amount = priceFor(rowCount);

    const order = orders.createOrder({
      userId: req.user ? req.user.id : null,
      email: req.user ? req.user.email : null,
      format,
      selection,
      rowCount,
      amount,
      currency: CURRENCY,
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ui_mode: 'embedded_page',
      // Bez payment_method_types - Stripe sam dobiera metody (BLIK, P24, karta)
      // na podstawie waluty i kraju klienta; zestaw włączamy w Dashboardzie.
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: CURRENCY,
            unit_amount: amount,
            product_data: {
              name: lineItemName(format, rowCount),
              description: describeFilters({ ...selection.filters, q: selection.q }),
            },
          },
        },
      ],
      client_reference_id: order.token,
      metadata: { order_token: order.token, format, row_count: String(rowCount) },
      payment_intent_data: { metadata: { order_token: order.token } },
      ...(req.user ? { customer_email: req.user.email } : {}),
      // 'if_required', nie 'never': metody bez przekierowania (karta, Link)
      // kończą się w modalu przez onComplete (public/js/checkout.js), ale BLIK,
      // Klarna i P24 WYMAGAJĄ przekierowania do banku - w trybie 'never' Stripe
      // by je ukrył. Dla nich Stripe użyje return_url i wróci na /platnosc.
      redirect_on_completion: 'if_required',
      return_url: `${baseUrl()}/platnosc?session_id={CHECKOUT_SESSION_ID}`,
    });

    orders.attachSession(order.id, session.id);

    return res.json({
      clientSecret: session.client_secret,
      ...orderPayload(orders.findByToken(order.token)),
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/api/checkout/:token', async (req, res, next) => {
  try {
    const order = orders.findByToken(req.params.token);
    if (!order) return res.status(404).json({ error: 'Nie znaleziono zamówienia.' });
    const synced = await syncOrderFromStripe(order);
    return res.json(orderPayload(synced));
  } catch (err) {
    return next(err);
  }
});

// Strona powrotu ze Stripe (return_url). Odpytuje stan i - gdy opłacone -
// podaje link do pobrania. BLIK potrafi potwierdzić się z opóźnieniem, więc
// widok sam odpytuje o status.
router.get('/platnosc', async (req, res, next) => {
  try {
    const order = orders.findBySessionId(req.query.session_id);
    if (!order) {
      return res.status(404).render('platnosc', { user: req.user || null, order: null });
    }
    const synced = await syncOrderFromStripe(order);
    return res.render('platnosc', { user: req.user || null, order: orderPayload(synced) });
  } catch (err) {
    return next(err);
  }
});

const DOWNLOAD_ERRORS = {
  unpaid: [402, 'Ten eksport nie został opłacony.'],
  expired: [410, `Link wygasł (ważny ${orders.DOWNLOAD_TTL_DAYS} dni od zakupu).`],
  limit: [429, `Wyczerpano limit pobrań (${orders.MAX_DOWNLOADS}).`],
  not_found: [404, 'Nie znaleziono zamówienia.'],
};

// Plik generujemy z kryteriów ZAPISANYCH w zamówieniu, nie z parametrów URL -
// to jest miejsce, w którym płatność faktycznie bramkuje dane.
router.get('/pobierz/:token', async (req, res, next) => {
  try {
    const order = orders.findByToken(req.params.token);
    if (!order) return res.status(404).send(DOWNLOAD_ERRORS.not_found[1]);

    const synced = await syncOrderFromStripe(order);
    const state = orders.downloadState(synced);
    if (!state.ok) {
      const [status, message] = DOWNLOAD_ERRORS[state.reason] || DOWNLOAD_ERRORS.unpaid;
      return res.status(status).send(message);
    }

    const selection = orders.parseSelection(synced);
    orders.registerDownload(synced);

    return streamExport(res, {
      format: synced.format,
      selection,
      filename: `instytucje-kultury-${synced.token.slice(0, 8)}`,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.syncOrderFromStripe = syncOrderFromStripe;
