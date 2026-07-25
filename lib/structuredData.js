// Dane strukturalne wspólne dla całego serwisu (Organization/WebSite) - w
// odróżnieniu od `structuredData` per-trasa (Dataset/FAQPage na /baza itp.),
// te dwa typy mają sens na każdej publicznej stronie, więc renderujemy je
// zawsze przez osobny, stały blok w partials/head.ejs (patrz app.js:
// res.locals.orgStructuredData).
const { seller } = require('./sellerInfo');
const { baseUrl } = require('./seo');

function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: seller.name,
    url: baseUrl(),
    email: seller.email,
    ...(seller.address ? { address: seller.address } : {}),
    ...(seller.nip ? { taxID: seller.nip } : {}),
  };
}

function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Baza Danych Instytucji Kultury',
    url: baseUrl(),
    inLanguage: 'pl-PL',
  };
}

module.exports = { organizationSchema, websiteSchema };
