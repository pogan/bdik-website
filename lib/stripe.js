const Stripe = require('stripe');

const secretKey = process.env.STRIPE_SECRET_KEY || '';
const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

// Bez kluczy aplikacja nadal wstaje (przeglądanie bazy działa) - płatności po
// prostu zgłaszają 503. Dzięki temu dev bez konta Stripe i testy nie wymagają .env.
const stripeConfigured = Boolean(secretKey && publishableKey);
const stripe = secretKey ? new Stripe(secretKey) : null;

// Stripe wymaga bezwzględnego URL-a powrotu; PUBLIC_BASE_URL musi być ustawiony
// na produkcji, bo inaczej klient wróci po płatności na localhost.
function baseUrl() {
  return (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
}

module.exports = { stripe, stripeConfigured, publishableKey, webhookSecret, baseUrl };
