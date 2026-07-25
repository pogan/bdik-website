// Wszystkie renderowane strony treściowe (produkt, prawne, o nas) razem z
// PUBLIC_PAGES - jedną listą publicznych, indeksowalnych adresów, z której
// korzysta zarówno ten plik (do budowy każdej trasy), jak i robots.txt/
// sitemap.xml w app.js. Wydzielone z app.js, żeby ten plik nie rósł w
// nieskończoność (patrz już wydzielone routes/api.js, routes/admin.js itd.) -
// to czysto mechaniczna ekstrakcja, zachowanie tras się nie zmienia.
const fs = require('fs');
const path = require('path');
const express = require('express');

const db = require('../db');
const { isAdmin } = require('../lib/projection');
const { adminViewSpec } = require('../lib/adminTable');
const { seller } = require('../lib/sellerInfo');
const { publishableKey, stripeConfigured } = require('../lib/stripe');
const { lastDataUpdate, lastDataUpdateDate } = require('../lib/dataFreshness');
const { TERMS_VERSION, isKnownTermsVersion, termsViewName } = require('../lib/legal');
const { baseUrl, canonicalUrl } = require('../lib/seo');
const { organizationSchema } = require('../lib/structuredData');
const { TIERS, MIN_AMOUNT, priceBreakdown, breakdownFromNet, formatAmount } = require('../lib/pricing');
const { countInstitutions, countWithContact, queryInstitutions, coverageCounts } = require('../lib/query');
const { PUBLIC_FIELDS } = require('../lib/projection');
const institutionTypes = require('../lib/institutionTypes');
const voivodeships = require('../lib/voivodeships');

const router = express.Router();

// Data ostatniej zmiany treści statycznych stron - mtime pliku widoku, liczone
// raz przy starcie procesu (te widoki nie zmieniają się w trakcie działania
// serwera, więc nie ma co odpytywać fs przy każdym żądaniu sitemap.xml).
const viewMtime = (viewRelPath) =>
  fs.statSync(path.join(__dirname, '..', 'views', `${viewRelPath}.ejs`)).mtime.toISOString().slice(0, 10);
const dataLastmod = () => lastDataUpdateDate().toISOString().slice(0, 10);

// robots.txt / sitemap.xml (app.js) budowane z tej samej listy publicznych,
// indeksowalnych tras co render'y poniżej - trzymamy je razem, żeby dodanie
// nowej strony publicznej nie wymagało pamiętania o osobnym pliku. Strony
// segmentów (województwo/typ) generowane programistycznie z tych samych
// statycznych list, którymi renderują się linki krzyżowe (partials/browse-links).
const PUBLIC_PAGES = [
  { path: '/baza', changefreq: 'daily', priority: '1.0', lastmod: dataLastmod() },
  ...voivodeships.all().map((v) => ({
    path: `/baza/wojewodztwo/${v.slug}`,
    changefreq: 'weekly',
    priority: '0.6',
    lastmod: dataLastmod(),
  })),
  ...institutionTypes.all().map((t) => ({
    path: `/baza/typ/${t.slug}`,
    changefreq: 'weekly',
    priority: '0.6',
    lastmod: dataLastmod(),
  })),
  { path: '/regulamin', changefreq: 'monthly', priority: '0.3', lastmod: TERMS_VERSION },
  { path: '/polityka-prywatnosci', changefreq: 'monthly', priority: '0.3', lastmod: viewMtime('legal/polityka-prywatnosci') },
  { path: '/o-nas', changefreq: 'monthly', priority: '0.4', lastmod: viewMtime('legal/o-nas') },
];

// BreadcrumbList wspólne dla stron segmentów (województwo/typ) - jedyne
// dane strukturalne, jakie te strony dostają (patrz uwaga w planie SEO:
// powielanie pełnego FAQPage na ~20 niemal identycznych stronach wyglądałoby
// jak content farm, więc FAQPage zostaje tylko na /baza i /o-nas).
function breadcrumbSchema(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

// Próbka instytucji renderowana po stronie serwera na stronach segmentów -
// widoczna bez JS (crawlery, fetchery LLM), w odróżnieniu od głównego
// narzędzia (#tool), które dociąga dane wyłącznie przez /api/institutions.
// Tylko PUBLIC_FIELDS - dokładnie to, co i tak jest dziś publiczne przez ten
// endpoint (patrz lib/projection.js), więc żadnych nowych danych nie ujawnia.
function sampleInstitutions(filters, limit = 20) {
  return queryInstitutions(db, {
    filters,
    columns: PUBLIC_FIELDS,
    sort: 'name',
    order: 'asc',
    page: 1,
    pageSize: limit,
    isAuthorized: false,
  }).rows;
}

function distinctLocalities(rows, limit = 5) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const locality = row.locality;
    if (locality && !seen.has(locality)) {
      seen.add(locality);
      out.push(locality);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function emailCoveragePercent(coverage) {
  if (!coverage.total || !coverage.fields.email) return 0;
  return Math.round((coverage.fields.email.filled / coverage.total) * 100);
}

// Sekcja #cennik na stronie bazy renderuje się z tych samych stałych, którymi
// serwer faktycznie wycenia eksport (lib/pricing.js) - cennik nie może się
// rozjechać z pobieraną kwotą. Przykłady liczone priceBreakdown, kwoty brutto.
function cennikView() {
  const example = (label, note, rows) => {
    const bd = priceBreakdown(rows);
    return { label, note, rows, gross: bd.gross, grossLabel: formatAmount(bd.gross) };
  };
  // Płatne są tylko rekordy z danymi kontaktowymi (patrz routes/payments.js),
  // więc przykład "cała baza" wycenia rekordy z kontaktem, nie wszystkie wiersze.
  const totalRows = countInstitutions(db);
  const billableRows = countWithContact(db);
  const minGross = breakdownFromNet(MIN_AMOUNT).gross;
  const wholeBase = example('Cała baza', `${totalRows} instytucji, płatne ${billableRows} z kontaktem`, billableRows);
  return {
    tiers: TIERS.map((t, i) => ({
      from: i === 0 ? 1 : TIERS[i - 1].upTo + 1,
      upTo: t.upTo === Infinity ? null : t.upTo,
      perRowLabel: formatAmount(t.perRow),
    })),
    // Grosze (nie tylko etykieta) - potrzebne do schema.org Product/AggregateOffer
    // (trasa /baza poniżej), żeby cena w danych strukturalnych nie mogła się
    // rozjechać z prawdziwym cennikiem (ten sam wzorzec co reszta tej funkcji).
    minGross,
    minGrossLabel: formatAmount(minGross),
    examples: [
      example('Jedna miejscowość', 'np. wybrane miasto, ok. 25 rekordów z kontaktem', 25),
      example('Całe województwo', 'ok. 150 rekordów z kontaktem', 150),
      wholeBase,
    ],
  };
}

// FAQ zdefiniowane raz: te same pytania renderują akordeon na stronie bazy
// oraz dane strukturalne FAQPage (schema.org) - treść nie może się rozjechać.
function faqView(dataUpdatedAt) {
  return [
    {
      q: 'Skąd pochodzą dane i jak często są aktualizowane?',
      a:
        'Dane pochodzą z publicznych rejestrów (m.in. KRS, REGON/GUS i rejestry instytucji kultury) ' +
        'i są dodatkowo ręcznie uzupełniane o telefony, adresy e-mail i strony WWW ze stron samych ' +
        `instytucji. Ostatnia aktualizacja bazy: ${dataUpdatedAt}.`,
    },
    {
      q: 'Co dokładnie zawiera kupiony plik?',
      a:
        'Każdy rekord to jedna instytucja: nazwa, pełny adres (województwo, powiat, gmina, miejscowość, ' +
        'ulica, kod pocztowy), telefon, e-mail, strona WWW i REGON. Eksport CSV i XLSX zawiera dodatkowo ' +
        'm.in. NIP, formę prawną, kod PKD i daty rozpoczęcia działalności. Przed zakupem możesz pobrać ' +
        'bezpłatną próbkę PDF z 16 prawdziwymi rekordami.',
    },
    {
      q: 'Czy płacę za rekordy, które nie mają danych kontaktowych?',
      a:
        'Nie. Cena liczona jest wyłącznie za rekordy z co najmniej jednym kanałem kontaktu (telefon, ' +
        'e-mail lub WWW). Rekordy bez kontaktu trafiają do pliku gratis - dokładny podział widzisz ' +
        'przed płatnością.',
    },
    {
      q: 'Czy dostanę fakturę VAT?',
      a:
        'Tak. Przy płatności możesz podać NIP i dane firmy; fakturę wystawiamy na życzenie - wystarczy ' +
        'po zakupie wysłać e-mail z numerem zamówienia (adres znajdziesz w stopce strony i w ' +
        'potwierdzeniu zakupu).',
    },
    {
      q: 'Do czego mogę używać kupionej bazy?',
      a:
        'Do własnych działań: kontaktu z instytucjami, planowania tras koncertowych, wystaw czy ' +
        'warsztatów oraz wysyłki własnych ofert. Licencja obejmuje użytek własny - bez odsprzedaży ' +
        'i publicznego udostępniania pliku. Szczegóły w Regulaminie.',
    },
    {
      q: 'Jak płacę i kiedy dostanę plik?',
      a:
        'Płatność obsługuje Stripe: BLIK, Przelewy24 lub karta. Plik pobierasz od razu po potwierdzeniu ' +
        'płatności; link do pobrania działa 24 godziny (do 10 pobrań) i wysyłamy go też na Twój e-mail.',
    },
    {
      q: 'Co jeśli mam zastrzeżenia do kupionego pliku?',
      a:
        'Napisz na adres e-mail podany w stopce, dołączając numer zamówienia z potwierdzenia. ' +
        'Każdą reklamację rozpatrujemy indywidualnie zgodnie z Regulaminem.',
    },
    // Pytania informacyjne (nie tylko transakcyjne) - liczby z tego samego
    // filtra 'type', którym filtruje się tabela i strony /baza/typ/:slug
    // (lib/institutionTypes.js), więc nie mogą się rozjechać z tym, co widać
    // w narzędziu.
    {
      q: 'Czym różni się dom kultury od centrum i ośrodka kultury?',
      a:
        'Formalnie niczym - to synonimy funkcjonujące obok siebie w polskim nazewnictwie, zwykle ' +
        'samorządowe instytucje kultury gminy lub miasta. Nazwa ("dom kultury", "centrum kultury", ' +
        '"ośrodek kultury") wynika z tradycji lokalnej i decyzji założycielskiej, nie z odrębnych ' +
        'przepisów - zakres działania (zajęcia, wystawy, koncerty, warsztaty) bywa bardzo podobny.',
    },
    {
      q: 'Ile domów kultury, bibliotek i centrów kultury działa w Polsce?',
      a:
        `W samej tej bazie jest ${countInstitutions(db, { filters: { type: 'domy-kultury' } })} domów kultury, ` +
        `${countInstitutions(db, { filters: { type: 'centra-kultury' } })} centrów kultury, ` +
        `${countInstitutions(db, { filters: { type: 'osrodki-kultury' } })} ośrodków kultury i ` +
        `${countInstitutions(db, { filters: { type: 'biblioteki' } })} bibliotek - w sumie ` +
        `${countInstitutions(db)} instytucji kultury z 16 województw. Dokładny rozkład wg regionu i ` +
        'typu zobaczysz niżej, w sekcji "Przeglądaj bazę według regionu i typu instytucji".',
    }
  ];
}

router.get('/baza', (req, res) => {
  const description =
    'Baza ponad 2 200 domów kultury, bibliotek i centrów kultury w Polsce. ' +
    'Filtruj po województwie, powiecie, gminie i miejscowości, sprawdź dane ' +
    'kontaktowe i wyeksportuj listę do CSV, XLSX lub PDF.';
  const faq = faqView(lastDataUpdate());
  const cennik = cennikView();
  res.render('baza', {
    cennik,
    faq,
    institutionTypes: institutionTypes.all(),
    voivodeshipsList: voivodeships.all(),
    user: req.user || null,
    stripePublishableKey: publishableKey,
    stripeConfigured,
    // Rozszerzony widok (wszystkie kolumny + filtr na każdej z nich) dostaje
    // wyłącznie administrator; dla reszty spec jest pusty, więc tabela zostaje
    // taka jak dotąd.
    adminView: isAdmin(req) ? adminViewSpec() : null,
    dataUpdatedAt: lastDataUpdate(),
    title: 'Baza Danych Instytucji Kultury — kontakty do domów kultury i bibliotek',
    description,
    robots: 'index, follow',
    canonicalUrl: canonicalUrl('/baza'),
    structuredData: [
      {
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name: 'Baza Danych Instytucji Kultury',
        description,
        url: canonicalUrl('/baza'),
        license: canonicalUrl('/regulamin'),
        isAccessibleForFree: false,
        keywords: ['domy kultury', 'biblioteki', 'centra kultury', 'instytucje kultury', 'kontakty'],
        creator: {
          '@type': 'Organization',
          name: seller.name,
          email: seller.email,
          url: baseUrl(),
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faq.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Eksport bazy instytucji kultury (CSV/XLSX/PDF)',
        description,
        brand: { '@type': 'Organization', name: seller.name },
        // Ceny wprost z cennikView() (ta sama funkcja renderuje widoczny cennik
        // #cennik) - low/high nie mogą się rozjechać z prawdziwymi kwotami.
        offers: {
          '@type': 'AggregateOffer',
          priceCurrency: 'PLN',
          lowPrice: (cennik.minGross / 100).toFixed(2),
          highPrice: (cennik.examples[cennik.examples.length - 1].gross / 100).toFixed(2),
          offerCount: cennik.tiers.length,
          availability: 'https://schema.org/InStock',
          url: canonicalUrl('/baza'),
        },
      },
    ],
  });
});

// Strony programistyczne per województwo - server-rendered próbka + wstępnie
// zawężone narzędzie (#tool), żeby crawlery bez JS (i część fetcherów LLM)
// widziały realną treść, nie tylko pusty kontener wypełniany przez table.js.
// H1/opis mają inną strukturę zdań niż strony typu (poniżej) - patrz uwaga
// w planie SEO o unikaniu sygnału "jeden szablon, N niemal identycznych stron".
router.get('/baza/wojewodztwo/:slug', (req, res) => {
  const voi = voivodeships.bySlug(req.params.slug);
  if (!voi) return res.status(404).render('404', { user: req.user || null });

  const filters = { voivodeship: voi.value };
  const total = countInstitutions(db, { filters });
  const coverage = coverageCounts(db, { filters });
  const sample = sampleInstitutions(filters);
  const localities = distinctLocalities(sample);
  // Rozbicie krzyżowe wojewodztwo+typ - buildWhere (lib/query.js) już wspiera
  // oba filtry naraz, więc to tylko N dodatkowych zapytań COUNT, bez zmian
  // w warstwie danych. Tylko typy z >0 wynikami trafiają na stronę.
  const typeBreakdown = institutionTypes
    .all()
    .map((t) => ({ ...t, count: countInstitutions(db, { filters: { voivodeship: voi.value, type: t.slug } }) }))
    .filter((t) => t.count > 0);

  const title = `Domy kultury, biblioteki i centra kultury w województwie ${voi.locative} — baza kontaktów`;
  const description = `${total} instytucji kultury w województwie ${voi.locative}: domy kultury, biblioteki, ` +
    'centra i ośrodki kultury. Sprawdź dane kontaktowe i pobierz listę do CSV, XLSX lub PDF.';

  res.render('baza-segment', {
    kind: 'voivodeship',
    segment: voi,
    total,
    coverage,
    emailPct: emailCoveragePercent(coverage),
    localities,
    sample,
    typeBreakdown,
    voivodeshipBreakdown: null,
    cennik: cennikView(),
    institutionTypes: institutionTypes.all(),
    voivodeshipsList: voivodeships.all(),
    user: req.user || null,
    stripePublishableKey: publishableKey,
    stripeConfigured,
    adminView: isAdmin(req) ? adminViewSpec() : null,
    dataUpdatedAt: lastDataUpdate(),
    title,
    description,
    robots: 'index, follow',
    canonicalUrl: canonicalUrl(`/baza/wojewodztwo/${voi.slug}`),
    initialFilters: { voivodeship: voi.value },
    structuredData: [
      breadcrumbSchema([
        { name: 'Baza Danych Instytucji Kultury', url: canonicalUrl('/baza') },
        { name: voi.label, url: canonicalUrl(`/baza/wojewodztwo/${voi.slug}`) },
      ]),
    ],
  });
});

// Strony programistyczne per typ instytucji - patrz komentarz przy trasie
// /baza/wojewodztwo/:slug powyżej (ten sam mechanizm, druga oś podziału).
router.get('/baza/typ/:slug', (req, res) => {
  const type = institutionTypes.bySlug(req.params.slug);
  if (!type) return res.status(404).render('404', { user: req.user || null });

  const filters = { type: type.slug };
  const total = countInstitutions(db, { filters });
  const coverage = coverageCounts(db, { filters });
  const sample = sampleInstitutions(filters);
  const localities = distinctLocalities(sample);
  const voivodeshipBreakdown = voivodeships
    .all()
    .map((v) => ({ ...v, count: countInstitutions(db, { filters: { voivodeship: v.value, type: type.slug } }) }))
    .filter((v) => v.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const title = `${type.label} w Polsce — baza kontaktów (${total})`;
  const description = `${total} ${type.plural} w Polsce z danymi kontaktowymi. Filtruj po województwie, ` +
    'powiecie i gminie, sprawdź dane kontaktowe i pobierz listę do CSV, XLSX lub PDF.';

  res.render('baza-segment', {
    kind: 'type',
    segment: type,
    total,
    coverage,
    emailPct: emailCoveragePercent(coverage),
    localities,
    sample,
    typeBreakdown: null,
    voivodeshipBreakdown,
    cennik: cennikView(),
    institutionTypes: institutionTypes.all(),
    voivodeshipsList: voivodeships.all(),
    user: req.user || null,
    stripePublishableKey: publishableKey,
    stripeConfigured,
    adminView: isAdmin(req) ? adminViewSpec() : null,
    dataUpdatedAt: lastDataUpdate(),
    title,
    description,
    robots: 'index, follow',
    canonicalUrl: canonicalUrl(`/baza/typ/${type.slug}`),
    initialFilters: { type: type.slug },
    structuredData: [
      breadcrumbSchema([
        { name: 'Baza Danych Instytucji Kultury', url: canonicalUrl('/baza') },
        { name: type.label, url: canonicalUrl(`/baza/typ/${type.slug}`) },
      ]),
    ],
  });
});

// Strony prawne. Regulamin obowiązujący pod /regulamin; konkretną (także
// archiwalną) wersję pod /regulamin/:wersja - potrzebne, bo e-mail potwierdzający
// linkuje do wersji z chwili zakupu (orders.terms_version). Wszystkie wersje
// canonicalizują na /regulamin, żeby archiwalne treści (niemal identyczne)
// nie konkurowały ze sobą o indeksację jako duplikaty.
router.get('/regulamin', (req, res) => {
  res.render('legal', {
    user: req.user || null,
    document: termsViewName(TERMS_VERSION),
    documentVersion: TERMS_VERSION,
    title: 'Regulamin — Baza Danych Instytucji Kultury',
    description: 'Regulamin świadczenia usług i sprzedaży eksportów danych w serwisie Baza Danych Instytucji Kultury.',
    robots: 'index, follow',
    canonicalUrl: canonicalUrl('/regulamin'),
  });
});

router.get('/regulamin/:wersja', (req, res) => {
  if (!isKnownTermsVersion(req.params.wersja)) {
    return res.status(404).send('Nie znaleziono tej wersji regulaminu.');
  }
  return res.render('legal', {
    user: req.user || null,
    document: termsViewName(req.params.wersja),
    documentVersion: req.params.wersja,
    title: `Regulamin (wersja z ${req.params.wersja}) — Baza Danych Instytucji Kultury`,
    description: 'Archiwalna wersja regulaminu serwisu Baza Danych Instytucji Kultury.',
    robots: 'index, follow',
    canonicalUrl: canonicalUrl('/regulamin'),
  });
});

router.get('/polityka-prywatnosci', (req, res) => {
  res.render('legal', {
    user: req.user || null,
    document: 'legal/polityka-prywatnosci',
    documentVersion: null,
    title: 'Polityka prywatności — Baza Danych Instytucji Kultury',
    description: 'Polityka prywatności i informacje o plikach cookies w serwisie Baza Danych Instytucji Kultury.',
    robots: 'index, follow',
    canonicalUrl: canonicalUrl('/polityka-prywatnosci'),
  });
});

// E-E-A-T: kto stoi za bazą, skąd dane, jak są weryfikowane - patrz
// views/legal/o-nas.ejs. AboutPage owija to samo Organization co reszta
// serwisu (res.locals.orgStructuredData), więc dane firmy nie mogą się
// rozjechać między stronami.
router.get('/o-nas', (req, res) => {
  const description = 'Kto prowadzi Bazę Danych Instytucji Kultury, skąd pochodzą dane i jak są weryfikowane.';
  res.render('legal', {
    user: req.user || null,
    document: 'legal/o-nas',
    documentVersion: null,
    totalInstitutions: countInstitutions(db),
    dataUpdatedAt: lastDataUpdate(),
    title: 'O nas — Baza Danych Instytucji Kultury',
    description,
    robots: 'index, follow',
    canonicalUrl: canonicalUrl('/o-nas'),
    structuredData: [
      {
        '@context': 'https://schema.org',
        '@type': 'AboutPage',
        name: 'O nas — Baza Danych Instytucji Kultury',
        description,
        url: canonicalUrl('/o-nas'),
        mainEntity: organizationSchema(),
      },
    ],
  });
});

module.exports = { router, PUBLIC_PAGES };
