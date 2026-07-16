// URL bazowy do canonical/OG/sitemap/robots.txt. Ta sama zmienna co w
// lib/stripe.js (PUBLIC_BASE_URL), duplikowana celowo zamiast importowana -
// to inny kontekst (metadane SEO), nie płatności, i nie chcemy, żeby zmiana
// jednego pociągała za sobą drugie.
function baseUrl() {
  return (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
}

function canonicalUrl(pathname) {
  return `${baseUrl()}${pathname}`;
}

module.exports = { baseUrl, canonicalUrl };
