// Dane strukturalne wspólne dla całego serwisu (Organization/WebSite) - w
// odróżnieniu od `structuredData` per-trasa (Dataset/FAQPage/Article itp.),
// te dwa typy mają sens na każdej publicznej stronie, więc renderujemy je
// zawsze przez osobny, stały blok w partials/head.ejs (patrz app.js:
// res.locals.orgStructuredData).
const { seller } = require('./sellerInfo');
const { baseUrl } = require('./seo');

// Profile w serwisach zewnętrznych (LinkedIn/Facebook itp.) - gdy powstaną,
// dopisz ich adresy tutaj: `sameAs` łączy stronę z encją w grafie wiedzy
// Google i pomaga modelom AI jednoznacznie zidentyfikować podmiot.
const SAME_AS = (process.env.ORG_SAME_AS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Baza Danych Instytucji Kultury',
    legalName: seller.name || undefined,
    url: baseUrl(),
    logo: `${baseUrl()}/images/logo.png`,
    image: `${baseUrl()}/images/og-cover.png`,
    email: seller.email,
    description:
      'Serwis udostępniający uporządkowaną bazę kontaktową polskich instytucji kultury ' +
      '(domy kultury, centra i ośrodki kultury, biblioteki publiczne) na podstawie ' +
      'publicznych rejestrów i ręcznej weryfikacji danych.',
    ...(seller.address ? { address: seller.address } : {}),
    ...(seller.nip ? { taxID: seller.nip } : {}),
    ...(SAME_AS.length ? { sameAs: SAME_AS } : {}),
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: seller.email,
      areaServed: 'PL',
      availableLanguage: ['Polish'],
    },
  };
}

function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Baza Danych Instytucji Kultury',
    url: baseUrl(),
    inLanguage: 'pl-PL',
    publisher: { '@type': 'Organization', name: seller.name, url: baseUrl() },
  };
}

module.exports = { organizationSchema, websiteSchema };
