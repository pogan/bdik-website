// Dane sprzedawcy w JEDNYM miejscu - używane w stopce, regulaminie, polityce
// prywatności, e-mailu potwierdzającym i na fakturze. Źródłem są zmienne .env,
// żeby dane rejestrowe (adres, NIP) nie były zaszyte w kodzie i widoku; wartości
// domyślne pozwalają aplikacji wstać w devie bez pełnej konfiguracji.
const seller = {
  name: process.env.SELLER_NAME || 'Your Company Sp. z o.o.',
  address: process.env.SELLER_ADDRESS || '', // ulica, kod, miejscowość - do uzupełnienia w .env
  nip: process.env.SELLER_NIP || '',
  regon: process.env.SELLER_REGON || '',
  email: process.env.SELLER_EMAIL || 'you@example.com',
};

// Czy komplet danych wymaganych prawem (nazwa, adres, NIP, e-mail) jest ustawiony.
// Brak adresu w .env to na produkcji błąd konfiguracji - stopka pokaże wtedy
// ostrzeżenie zamiast pustego pola, a log przy starcie o tym przypomni.
seller.complete = Boolean(seller.name && seller.address && seller.nip && seller.email);

if (process.env.NODE_ENV === 'production' && !seller.complete) {
  console.warn(
    'sellerInfo: niekompletne dane sprzedawcy (SELLER_ADDRESS/NIP/EMAIL) - ' +
      'stopka i dokumenty prawne wymagają kompletu danych rejestrowych.',
  );
}

module.exports = { seller };
