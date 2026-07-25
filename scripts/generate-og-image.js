// Jednorazowy, offline build obrazka OG (nie w request path - patrz scripts/vendor.js
// dla tego samego wzorca "zbuduj raz, zacommituj wynik"). Serwis nie miał dotąd
// żadnych obrazów rastrowych; jeden statyczny 1200x630 wystarcza na start (bez
// dynamicznych wariantów per strona - patrz uwaga w planie SEO).
// Uruchomienie: npm run og-image (PUBLIC_BASE_URL z .env trafia do napisu z
// domeną w prawym dolnym rogu - przed publikacją uruchomić z produkcyjnym env,
// inaczej obrazek pokaże "localhost").
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const db = require('../db');
const { countInstitutions } = require('../lib/query');
const { baseUrl } = require('../lib/seo');

const WIDTH = 1200;
const HEIGHT = 630;
const ACCENT = '#6d5ae6';
const ACCENT_STRONG = '#5a46d6';

// Zaokrąglone w dół do pełnej setki - ten sam styl co "2 200+" w hero na /baza
// (baza.ejs), żeby liczba nie wyglądała na fałszywie precyzyjną i nie wymagała
// regeneracji obrazka przy każdej pojedynczej zmianie w danych.
const roundedTotal = Math.floor(countInstitutions(db) / 100) * 100;
const hostname = new URL(baseUrl()).hostname;
db.close();

const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${ACCENT}"/>
      <stop offset="100%" stop-color="${ACCENT_STRONG}"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="rgba(15,23,42,0.06)"/>

  <rect x="80" y="80" width="72" height="72" rx="18" fill="#ffffff"/>
  <text x="116" y="130" font-family="Inter" font-weight="700" font-size="40" fill="${ACCENT}" text-anchor="middle">B</text>

  <text x="80" y="290" font-family="Inter" font-weight="700" font-size="64" fill="#ffffff">Baza Danych</text>
  <text x="80" y="365" font-family="Inter" font-weight="700" font-size="64" fill="#ffffff">Instytucji Kultury</text>

  <text x="80" y="440" font-family="Inter" font-weight="500" font-size="30" fill="#ffffff" opacity="0.92">
    Kontakty do ${String(roundedTotal).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}+ domów kultury, bibliotek i centrów kultury
  </text>
  <text x="80" y="482" font-family="Inter" font-weight="500" font-size="30" fill="#ffffff" opacity="0.92">
    w 16 województwach
  </text>

  <text x="80" y="560" font-family="Inter" font-weight="600" font-size="24" fill="#ffffff" opacity="0.85">${hostname}</text>
</svg>
`.trim();

// resvg (ttf-parser) nie parsuje self-hostowanych WOFF2 (public/vendor/fonts) -
// stąd loadSystemFonts zamiast fontFiles. To jednorazowy, ręcznie uruchamiany
// skrypt budujący commitowany PNG (jak scripts/vendor.js), więc zależność od
// fontów zainstalowanych na maszynie, na której się go uruchamia, jest OK;
// przy braku Inter w systemie resvg dobierze najbliższy dostępny sans-serif.
const resvg = new Resvg(svg, {
  font: {
    loadSystemFonts: true,
    defaultFontFamily: 'Inter',
  },
  background: ACCENT,
});

const png = resvg.render().asPng();
const outPath = path.join(__dirname, '..', 'public', 'images', 'og-cover.png');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, png);
console.log(`Zapisano ${outPath} (${png.length} B), instytucji w bazie: ${roundedTotal}+`);
