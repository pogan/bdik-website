// Kod rabatowy dla leadów (próbka na e-mail). Sam kod i jego procent żyją
// w Stripe (promotion code, domyślnie DISCOUNT20 - patrz lib/mailer.js);
// tu jest tylko to, jak go komunikujemy: "RABAT DO X zł", gdzie X to
// PROMO_PERCENT od najwyższej możliwej ceny (cała baza, brutto), w dół do
// pełnych złotych. Liczone z cennika i bazy, żeby nie rozjechało się z ceną.
const db = require('../db');
const { countWithContact } = require('./query');
const { priceBreakdown } = require('./pricing');

const PROMO_PERCENT = 20;

function promoMaxOffZl() {
  const maxGross = priceBreakdown(countWithContact(db)).gross; // grosze
  return Math.floor((maxGross * PROMO_PERCENT) / 100 / 100);
}

function promoLabel() {
  return `RABAT DO ${promoMaxOffZl()} zł`;
}

module.exports = { PROMO_PERCENT, promoMaxOffZl, promoLabel };
