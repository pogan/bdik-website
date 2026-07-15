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

// Stawka VAT jako obiekt TaxRate w Stripe. Dzięki niej pozycję rozliczamy jako
// netto + osobny VAT 23%, więc na paragonie/fakturze widać rozbicie, a nie jedną
// kwotę. Tworzymy ją raz i cache'ujemy (TaxRate'ów nie da się usunąć, więc
// szukamy istniejącej po markerze, zanim założymy nową). Można wskazać gotową
// przez STRIPE_TAX_RATE_ID.
let vatTaxRatePromise = null;
function getVatTaxRateId() {
  if (!stripe) return Promise.resolve(null);
  if (process.env.STRIPE_TAX_RATE_ID) return Promise.resolve(process.env.STRIPE_TAX_RATE_ID);
  if (!vatTaxRatePromise) {
    vatTaxRatePromise = (async () => {
      const existing = await stripe.taxRates.list({ active: true, limit: 100 });
      const found = existing.data.find(
        (r) => r.metadata && r.metadata.bdik_vat === 'pl23' && Number(r.percentage) === 23 && r.inclusive === false,
      );
      if (found) return found.id;
      const created = await stripe.taxRates.create({
        display_name: 'VAT',
        description: 'VAT 23% (Polska)',
        percentage: 23,
        inclusive: false,
        country: 'PL',
        metadata: { bdik_vat: 'pl23' },
      });
      return created.id;
    })().catch((err) => {
      vatTaxRatePromise = null; // nie zapamiętuj porażki - pozwól spróbować przy kolejnym zamówieniu
      throw err;
    });
  }
  return vatTaxRatePromise;
}

module.exports = { stripe, stripeConfigured, publishableKey, webhookSecret, baseUrl, getVatTaxRateId };
