// Kopiuje zasoby front-endu z node_modules do public/vendor, żeby serwować je z
// własnego serwera zamiast z CDN (bez wycieku IP użytkowników do Google Fonts /
// jsDelivr - istotne dla RODO). Pliki w public/vendor są commitowane do repo.
// Uruchamiaj po zmianie wersji Bootstrapa/ikon/czcionki: `node scripts/vendor.js`.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');
const OUT = path.join(ROOT, 'public', 'vendor');

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('  ', path.relative(ROOT, dest));
}

// Bootstrap CSS + JS.
copy(path.join(NM, 'bootstrap/dist/css/bootstrap.min.css'), path.join(OUT, 'bootstrap/bootstrap.min.css'));
copy(path.join(NM, 'bootstrap/dist/js/bootstrap.bundle.min.js'), path.join(OUT, 'bootstrap/bootstrap.bundle.min.js'));

// Bootstrap Icons: CSS odwołuje się do ./fonts/* względnie, więc kopiujemy oba
// pliki fontu obok CSS.
copy(path.join(NM, 'bootstrap-icons/font/bootstrap-icons.min.css'), path.join(OUT, 'bootstrap-icons/bootstrap-icons.min.css'));
copy(path.join(NM, 'bootstrap-icons/font/fonts/bootstrap-icons.woff2'), path.join(OUT, 'bootstrap-icons/fonts/bootstrap-icons.woff2'));
copy(path.join(NM, 'bootstrap-icons/font/fonts/bootstrap-icons.woff'), path.join(OUT, 'bootstrap-icons/fonts/bootstrap-icons.woff'));

// Czcionka Inter (latin, wagi 400-700) + własny arkusz @font-face.
const WEIGHTS = [400, 500, 600, 700];
for (const w of WEIGHTS) {
  copy(
    path.join(NM, `@fontsource/inter/files/inter-latin-${w}-normal.woff2`),
    path.join(OUT, `fonts/inter-latin-${w}-normal.woff2`),
  );
}
const faces = WEIGHTS.map(
  (w) => `@font-face{font-family:'Inter';font-style:normal;font-weight:${w};font-display:swap;` +
    `src:url('/vendor/fonts/inter-latin-${w}-normal.woff2') format('woff2');}`,
).join('\n');
fs.mkdirSync(path.join(OUT, 'fonts'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'fonts', 'inter.css'), faces + '\n');
console.log('   public/vendor/fonts/inter.css');

console.log('Gotowe: zasoby skopiowane do public/vendor.');
