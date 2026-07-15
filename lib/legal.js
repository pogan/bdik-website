// Wersjonowanie regulaminu. Każda wersja regulaminu to osobny widok
// views/legal/regulamin-<data>.ejs, a jego wersją jest data obowiązywania.
// Zamówienie zapisuje wersję zaakceptowaną przy zakupie (orders.terms_version),
// żeby po zmianie regulaminu dało się odtworzyć dokładnie tę treść, na którą
// klient wyraził zgodę - dlatego stare wersje zostają w repozytorium.
//
// Dodając nową wersję: utwórz views/legal/regulamin-<data>.ejs i dopisz jej datę
// NA POCZĄTEK TERMS_VERSIONS. Pierwszy element = wersja obowiązująca (linkowana
// w modalu i stopce).
const TERMS_VERSIONS = ['2026-07-15'];

const TERMS_VERSION = TERMS_VERSIONS[0];

// Czy podana wartość to znana wersja regulaminu - broni trasy /regulamin/:wersja
// przed path traversal (nie budujemy ścieżki widoku z niezaufanego parametru).
function isKnownTermsVersion(version) {
  return typeof version === 'string' && TERMS_VERSIONS.includes(version);
}

// Nazwa widoku (bez rozszerzenia) dla danej wersji regulaminu.
function termsViewName(version) {
  return `legal/regulamin-${version}`;
}

module.exports = {
  TERMS_VERSION,
  TERMS_VERSIONS,
  isKnownTermsVersion,
  termsViewName,
};
