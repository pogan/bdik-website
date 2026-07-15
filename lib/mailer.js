// Wysyłka e-maila potwierdzającego zakup przez SMTP (nodemailer). Konfiguracja z
// .env: SMTP_HOST/PORT/USER/PASS + MAIL_FROM. Bez konfiguracji aplikacja działa
// normalnie - wysyłka jest pomijana z ostrzeżeniem w logu (wzorzec jak
// stripeConfigured), a klient i tak ma link na stronie potwierdzenia.
const nodemailer = require('nodemailer');
const orders = require('./orders');
const { buildConfirmationEmail } = require('./orderEmail');
const { seller } = require('./sellerInfo');
const { baseUrl } = require('./stripe');
const { isKnownTermsVersion } = require('./legal');

const host = process.env.SMTP_HOST || '';
const port = parseInt(process.env.SMTP_PORT || '587', 10);
const user = process.env.SMTP_USER || '';
const pass = process.env.SMTP_PASS || '';
const from = process.env.MAIL_FROM || user;

const mailerConfigured = Boolean(host && from);

// secure=true dla portu 465 (implicit TLS), STARTTLS dla pozostałych.
const transporter = mailerConfigured
  ? nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    })
  : null;

// Absolutny link do pobrania (ten sam identyfikator co numer reklamacji).
function downloadUrlFor(order) {
  const id = order.stripe_payment_intent || order.token;
  return `${baseUrl()}/pobierz/${id}`;
}

function termsUrlFor(order) {
  if (order.terms_version && isKnownTermsVersion(order.terms_version)) {
    return `${baseUrl()}/regulamin/${order.terms_version}`;
  }
  return `${baseUrl()}/regulamin`;
}

// Wysyła potwierdzenie DOKŁADNIE raz (atomowy claim w orders) i nigdy nie rzuca -
// błąd wysyłki nie może zablokować obsługi webhooka ani odpowiedzi dla Stripe.
// Wołać po markPaid (webhook oraz synchronizacja ze Stripe).
function sendConfirmationSafe(order) {
  if (!order || order.status !== 'paid' || !order.email) return;

  // Zajmij wysyłkę zanim cokolwiek wyślesz - przy wyścigu tylko jeden wygra.
  if (!orders.claimConfirmationEmail(order)) return;

  if (!mailerConfigured) {
    console.warn(
      `Mailer niekonfigurowany (SMTP_*): pomijam potwierdzenie dla zamówienia ${order.token}. ` +
        'Klient ma link na stronie potwierdzenia.',
    );
    return;
  }

  const { subject, text, html } = buildConfirmationEmail(order, {
    downloadUrl: downloadUrlFor(order),
    seller,
    termsUrl: termsUrlFor(order),
  });

  transporter
    .sendMail({ from, to: order.email, subject, text, html })
    .catch((err) => {
      // Nie zwalniamy claima: nie chcemy pętli ponawiania przy trwałym błędzie.
      // Admin widzi brak potwierdzenia w panelu; można wysłać ręcznie.
      console.error(`Nie wysłano potwierdzenia dla ${order.token}:`, err.message);
    });
}

module.exports = { mailerConfigured, sendConfirmationSafe };
