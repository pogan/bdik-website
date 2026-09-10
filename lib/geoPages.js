// Katalog programistycznie generowanych stron segmentów drugiego poziomu:
// powiatów (/baza/wojewodztwo/:woj/powiat/:powiat) oraz przecięć
// województwo x typ instytucji (/baza/wojewodztwo/:woj/typ/:typ). Budowany
// raz przy starcie procesu z bazy - tak jak PUBLIC_PAGES w routes/pages.js -
// i używany zarówno do walidacji tras, jak i do sitemap.xml.
//
// Strona segmentu powstaje TYLKO, gdy stoi za nią realna treść: co najmniej
// MIN_RECORDS instytucji (sensowna próbka w tabeli, niepusty rozkład). To
// świadoma bariera przeciw sygnałowi "N niemal pustych, szablonowych stron"
// (patrz uwaga w routes/pages.js o powielaniu FAQPage / content farm).
const db = require('../db');
const voivodeships = require('./voivodeships');
const institutionTypes = require('./institutionTypes');
const { countInstitutions } = require('./query');
const { slugify } = require('./slug');

const MIN_RECORDS = 8;

const voiByValue = new Map(voivodeships.all().map((v) => [v.value, v]));

// Nazwa powiatu w bazie jest przymiotnikowa i WIELKIMI LITERAMI (np. "KŁODZKI").
// Odmiana przymiotników na -ski/-cki/-i jest regularna, więc miejscownik
// ("w powiecie kłodzkim") i dopełniacz ("powiatu kłodzkiego") liczymy prostą
// regułą końcówki. Powiaty grodzkie ("M. WROCŁAW") mają nazwę rzeczownikową,
// której nie odmienimy regułą - są wykluczane z listy (patrz buildCounties).
function adjLocative(adj) {
  if (/ki$/.test(adj)) return adj.replace(/ki$/, 'kim');
  if (/gi$/.test(adj)) return adj.replace(/gi$/, 'gim');
  return adj.replace(/[iy]$/, 'ym');
}
function adjGenitive(adj) {
  if (/ki$/.test(adj)) return adj.replace(/ki$/, 'kiego');
  if (/gi$/.test(adj)) return adj.replace(/gi$/, 'giego');
  return adj.replace(/[iy]$/, 'ego');
}

function buildCounties() {
  const rows = db
    .prepare(
      `SELECT voivodeship, county, COUNT(*) AS count
         FROM institutions
        WHERE regon NOT IN (SELECT regon FROM institution_optouts)
          AND county IS NOT NULL AND TRIM(county) <> ''
          AND county NOT LIKE 'M. %' AND county NOT LIKE 'M %'
        GROUP BY voivodeship, county
       HAVING count >= @min
        ORDER BY voivodeship, count DESC`
    )
    .all({ min: MIN_RECORDS });

  const out = [];
  for (const r of rows) {
    const voi = voiByValue.get(r.voivodeship);
    if (!voi) continue;
    const adj = r.county.toLowerCase();
    out.push({
      voivodeship: voi,
      countyValue: r.county,
      countySlug: slugify(r.county),
      label: `powiat ${adj}`,
      locative: `powiecie ${adjLocative(adj)}`,
      genitive: `powiatu ${adjGenitive(adj)}`,
      count: r.count,
      path: `/baza/wojewodztwo/${voi.slug}/powiat/${slugify(r.county)}`,
    });
  }
  return out;
}

function buildVoivodeshipTypes() {
  const out = [];
  for (const voi of voivodeships.all()) {
    for (const type of institutionTypes.all()) {
      const count = countInstitutions(db, { filters: { voivodeship: voi.value, type: type.slug } });
      if (count < MIN_RECORDS) continue;
      out.push({
        voivodeship: voi,
        type,
        count,
        path: `/baza/wojewodztwo/${voi.slug}/typ/${type.slug}`,
      });
    }
  }
  return out;
}

const COUNTIES = buildCounties();
const VOIVODESHIP_TYPES = buildVoivodeshipTypes();

const countyBy = new Map(COUNTIES.map((c) => [`${c.voivodeship.slug}/${c.countySlug}`, c]));
const voiTypeBy = new Map(VOIVODESHIP_TYPES.map((x) => [`${x.voivodeship.slug}/${x.type.slug}`, x]));

module.exports = {
  MIN_RECORDS,
  counties: () => COUNTIES,
  voivodeshipTypes: () => VOIVODESHIP_TYPES,
  countyBySlug: (voiSlug, countySlug) => countyBy.get(`${voiSlug}/${countySlug}`) || null,
  voivodeshipTypeBySlug: (voiSlug, typeSlug) => voiTypeBy.get(`${voiSlug}/${typeSlug}`) || null,
  countiesInVoivodeship: (voiSlug) => COUNTIES.filter((c) => c.voivodeship.slug === voiSlug),
  typesInVoivodeship: (voiSlug) => VOIVODESHIP_TYPES.filter((x) => x.voivodeship.slug === voiSlug),
  voivodeshipsForType: (typeSlug) => VOIVODESHIP_TYPES.filter((x) => x.type.slug === typeSlug),
};
