const express = require('express');
const orders = require('../lib/orders');
const { stripe, webhookSecret } = require('../lib/stripe');

const router = express.Router();

// UWAGA: ten router MUSI być zamontowany przed express.json() i z express.raw(),
// bo weryfikacja podpisu Stripe liczy HMAC z surowego body - sparsowany i
// ponownie zserializowany JSON daje inne bajty i podpis się nie zgadza.
router.post('/stripe', (req, res) => {
  if (!stripe || !webhookSecret) {
    return res.status(503).send('Webhook Stripe nie jest skonfigurowany.');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret);
  } catch (err) {
    console.error('Stripe webhook: nieprawidłowy podpis -', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Stripe dostarcza zdarzenia "at least once" - powtórkę kwitujemy 200 bez
  // ponownego przetwarzania.
  if (!orders.rememberEvent(event.id, event.type)) {
    return res.json({ received: true, duplicate: true });
  }

  const session = event.data.object;
  const order = orders.findBySessionId(session.id) || orders.findByToken(session.client_reference_id);
  if (!order) {
    console.warn('Stripe webhook: brak zamówienia dla sesji', session.id);
    return res.json({ received: true });
  }

  switch (event.type) {
    // BLIK i przelewy potrafią rozliczyć się asynchronicznie - dlatego
    // dopuszczamy do zapłaty tylko sesje faktycznie opłacone.
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      if (session.payment_status === 'paid') {
        orders.markPaid(order, {
          paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
          email: session.customer_details ? session.customer_details.email : null,
        });
      }
      break;
    case 'checkout.session.async_payment_failed':
      orders.markStatus(order, 'failed');
      break;
    case 'checkout.session.expired':
      orders.markStatus(order, 'expired');
      break;
    default:
      break;
  }

  return res.json({ received: true });
});

module.exports = router;
