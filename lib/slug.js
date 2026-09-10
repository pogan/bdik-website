// Slug bez polskich znaków - wspólny dla programistycznie generowanych stron
// powiatów (routes/pages.js). Wartości powiatów pochodzą z bazy (nie ma
// statycznej listy jak dla województw w lib/voivodeships.js), więc slug liczymy
// z wartości, a mapę odwrotną (slug -> wartość z bazy) buduje raz lib/geoPages.js.
const PL_MAP = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
  Ą: 'a', Ć: 'c', Ę: 'e', Ł: 'l', Ń: 'n', Ó: 'o', Ś: 's', Ź: 'z', Ż: 'z',
};

function slugify(value) {
  return String(value)
    .replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (ch) => PL_MAP[ch])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { slugify };
