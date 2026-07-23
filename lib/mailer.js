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

// Wysyłka próbki (i ewentualnego kodu rabatowego) na adres zostawiony w
// formularzu leadów. Nigdy nie rzuca - zapis leada nie może zależeć od SMTP.
function sendLeadSampleSafe(email) {
  if (!mailerConfigured) {
    console.warn(`Mailer niekonfigurowany (SMTP_*): pomijam wysyłkę próbki do ${email}.`);
    return;
  }

  const sampleUrl = `${baseUrl()}/pliki/przykladowa-lista-instytucji-kultury.pdf`;
  // Kod rabatowy dla leadów - musi istnieć jako promotion code w Stripe
  // Dashboard (pole "Add code" w Checkout). LEAD_PROMO_CODE w .env nadpisuje
  // domyślny DISCOUNT20 (np. przy rotacji kodu).
  const promoCode = process.env.LEAD_PROMO_CODE || 'DISCOUNT20';

  const subject = promoCode
    ? 'Twoja próbka bazy instytucji kultury + kod rabatowy'
    : 'Twoja próbka bazy instytucji kultury';
  const promoText = promoCode
    ? `\n\nPrzy pierwszym zakupie eksportu wpisz w formularzu płatności kod rabatowy: ${promoCode}\n`
    : '';
  const text =
    `Dzień dobry,\n\n` +
    `w załączeniu link do przykładowej listy 16 instytucji kultury (po jednej z każdego województwa, ` +
    `z kompletem danych kontaktowych):\n${sampleUrl}\n` +
    promoText +
    `\nPełną bazę przefiltrujesz i pobierzesz tutaj: ${baseUrl()}/baza\n\n` +
    `Pozdrawiamy,\n${seller.name}\n\n` +
    `Otrzymujesz tę wiadomość, bo Twój adres został podany w formularzu próbki na ${baseUrl()}. ` +
    `Aby wycofać zgodę, odpowiedz na tę wiadomość lub napisz na ${seller.email}.`;

  transporter.sendMail({ from, to: email, subject, text }).catch((err) => {
    console.error(`Nie wysłano próbki do ${email}:`, err.message);
  });
}

module.exports = { mailerConfigured, sendConfirmationSafe, sendLeadSampleSafe };
