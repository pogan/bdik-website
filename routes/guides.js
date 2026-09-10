// Poradniki (/poradniki, /poradniki/:slug) - treść informacyjna pod zapytania
// z górnej części lejka i cytowania w odpowiedziach AI. Metadane trzyma
// lib/guides.js (współdzielone z sitemap.xml). Widoki: views/poradniki-index.ejs
// oraz views/guide.ejs -> views/poradniki/<slug>.ejs.
const express = require('express');

const db = require('../db');
const guides = require('../lib/guides');
const voivodeships = require('../lib/voivodeships');
const institutionTypes = require('../lib/institutionTypes');
const { seller } = require('../lib/sellerInfo');
const { baseUrl, canonicalUrl } = require('../lib/seo');
const { lastDataUpdate } = require('../lib/dataFreshness');
const { countInstitutions } = require('../lib/query');

const router = express.Router();

function articleSchema(guide) {
  const url = canonicalUrl(`/poradniki/${guide.slug}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: guide.title,
    description: guide.description,
    datePublished: guide.published,
    dateModified: guide.updated,
    inLanguage: 'pl-PL',
    mainEntityOfPage: url,
    url,
    author: { '@type': 'Organization', name: seller.name, url: baseUrl() },
    publisher: {
      '@type': 'Organization',
      name: seller.name,
      url: baseUrl(),
      logo: { '@type': 'ImageObject', url: `${baseUrl()}/images/logo.png` },
    },
  };
}

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

// Żywe liczby dla /poradniki/ile-jest-domow-kultury-w-polsce - te same funkcje
// i te same slugi stron segmentów, więc tabela w poradniku nie rozjedzie się
// z resztą serwisu.
function institutionStats() {
  return {
    dataUpdatedAt: lastDataUpdate(),
    total: countInstitutions(db),
    byType: institutionTypes.all().map((t) => ({
      label: t.label,
      count: countInstitutions(db, { filters: { type: t.slug } }),
      href: canonicalUrl(`/baza/typ/${t.slug}`),
    })),
    byVoivodeship: voivodeships
      .all()
      .map((v) => ({
        label: v.label,
        count: countInstitutions(db, { filters: { voivodeship: v.value } }),
        href: canonicalUrl(`/baza/wojewodztwo/${v.slug}`),
      }))
      .sort((a, b) => b.count - a.count),
  };
}

router.get('/poradniki', (req, res) => {
  res.render('poradniki-index', {
    user: req.user || null,
    guides: guides.all(),
    title: 'Poradniki — Baza Danych Instytucji Kultury',
    description:
      'Jak zaproponować koncert domowi kultury, jak napisać ofertę warsztatów, ile jest ' +
      'domów kultury w Polsce. Praktyczne poradniki dla artystów i animatorów kultury.',
    robots: 'index, follow',
    canonicalUrl: canonicalUrl('/poradniki'),
    structuredData: [
      breadcrumbSchema([
        { name: 'Baza Danych Instytucji Kultury', url: canonicalUrl('/baza') },
        { name: 'Poradniki', url: canonicalUrl('/poradniki') },
      ]),
    ],
  });
});

router.get('/poradniki/:slug', (req, res) => {
  const guide = guides.bySlug(req.params.slug);
  if (!guide) return res.status(404).render('404', { user: req.user || null });

  res.render('guide', {
    user: req.user || null,
    guide,
    stats: guide.dynamic ? institutionStats() : null,
    title: `${guide.title} — Baza Danych Instytucji Kultury`,
    description: guide.description,
    ogTitle: guide.title,
    robots: 'index, follow',
    canonicalUrl: canonicalUrl(`/poradniki/${guide.slug}`),
    structuredData: [
      articleSchema(guide),
      breadcrumbSchema([
        { name: 'Baza Danych Instytucji Kultury', url: canonicalUrl('/baza') },
        { name: 'Poradniki', url: canonicalUrl('/poradniki') },
        { name: guide.title, url: canonicalUrl(`/poradniki/${guide.slug}`) },
      ]),
    ],
  });
});

module.exports = router;
