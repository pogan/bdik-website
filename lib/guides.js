// Poradniki (/poradniki, /poradniki/:slug) - treść informacyjna (nie
// transakcyjna), pod zapytania z górnej części lejka i cytowania w
// odpowiedziach AI. Metadane w jednym miejscu: korzysta z nich routes/guides.js
// (render + Article JSON-LD) oraz PUBLIC_PAGES/sitemap w routes/pages.js.
// `updated` to jednocześnie <lastmod> w sitemapie i dateModified w schema -
// aktualizuj przy każdej realnej zmianie treści danego widoku.
const GUIDES = [
  {
    slug: 'jak-zaproponowac-koncert-domowi-kultury',
    title: 'Jak zaproponować koncert domowi kultury — poradnik krok po kroku',
    description:
      'Jak znaleźć właściwą osobę, co napisać w pierwszym mailu do domu kultury, ' +
      'kiedy wysyłać propozycję koncertu i jak rozmawiać o honorarium.',
    published: '2026-09-10',
    updated: '2026-09-10',
    view: 'poradniki/jak-zaproponowac-koncert-domowi-kultury',
  },
  {
    slug: 'oferta-warsztatow-dla-domu-kultury',
    title: 'Jak napisać ofertę warsztatów dla domu kultury lub biblioteki',
    description:
      'Struktura skutecznej oferty warsztatów dla instytucji kultury: opis zajęć, ' +
      'grupa docelowa, wymagania techniczne, wycena i formalności.',
    published: '2026-09-10',
    updated: '2026-09-10',
    view: 'poradniki/oferta-warsztatow-dla-domu-kultury',
  },
  {
    slug: 'ile-jest-domow-kultury-w-polsce',
    title: 'Ile jest domów kultury, centrów kultury i bibliotek w Polsce',
    description:
      'Liczba samorządowych instytucji kultury w Polsce według typu i województwa, ' +
      'na podstawie publicznych rejestrów (KRS, REGON/GUS).',
    published: '2026-09-10',
    updated: '2026-09-10',
    view: 'poradniki/ile-jest-domow-kultury-w-polsce',
    // Widok korzysta z żywych liczb z bazy - routes/guides.js dokłada je do locals.
    dynamic: true,
  },
];

const BY_SLUG = new Map(GUIDES.map((g) => [g.slug, g]));

module.exports = {
  all: () => GUIDES,
  bySlug: (slug) => BY_SLUG.get(slug) || null,
};
