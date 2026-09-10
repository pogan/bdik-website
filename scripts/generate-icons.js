// Jednorazowy, offline build ikon rastrowych (favicony, apple-touch-icon,
// ikony PWA, logo do Organization JSON-LD) z tego samego znaku "B" co
// public/favicon.svg. Ten sam wzorzec "zbuduj raz, zacommituj wynik" co
// scripts/generate-og-image.js i scripts/vendor.js.
// Uruchomienie: npm run icons
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const ACCENT = '#6d5ae6';
const OUT_DIR = path.join(__dirname, '..', 'public');

// Znak w kwadracie - favicony i ikony PWA (tło wypełnia całość, bez marginesu).
const markSquare = (size) => `
<svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="32" rx="7" fill="${ACCENT}"/>
  <text x="16" y="23" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
        font-weight="700" font-size="18" fill="#ffffff">B</text>
</svg>`.trim();

// Logo do schema.org Organization - Google potrafi je pokazać na białym tle,
// więc lekki margines i przezroczyste tło wokół znaku.
const logo = (size) => {
  const pad = Math.round(size * 0.12);
  const inner = size - pad * 2;
  return `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(${pad} ${pad})">
    <rect width="${inner}" height="${inner}" rx="${Math.round(inner * 0.22)}" fill="${ACCENT}"/>
    <text x="${inner / 2}" y="${inner * 0.72}" text-anchor="middle"
          font-family="Arial, Helvetica, sans-serif" font-weight="700"
          font-size="${inner * 0.58}" fill="#ffffff">B</text>
  </g>
</svg>`.trim();
};

function render(svg, size, file) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  const out = path.join(OUT_DIR, file);
  fs.writeFileSync(out, png);
  console.log(`${file} (${size}px, ${png.length} B)`);
}

render(markSquare(48), 48, 'favicon-48.png');
render(markSquare(180), 180, 'apple-touch-icon.png');
render(markSquare(192), 192, 'icon-192.png');
render(markSquare(512), 512, 'icon-512.png');
render(logo(512), 512, 'images/logo.png');
