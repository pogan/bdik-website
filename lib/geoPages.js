// Katalog programistycznie generowanych stron segmentów drugiego poziomu:
// miast (/baza/wojewodztwo/:woj/miasto/:miasto) oraz przecięć
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
const { displayCase } = require('./textCase');

const MIN_RECORDS = 8;

const voiByValue = new Map(voivodeships.all().map((v) => [v.value, v]));

// Strony miast: /baza/wojewodztwo/:woj/miasto/:miasto. Zastąpiły strony
// powiatów - ludzie szukają instytucji kultury "w Krakowie" albo "w małopolskim",
// nie "w powiecie krakowskim", a powiat z 8-20 rekordami był cienką, szablonową
// stroną (Google zostawiał je jako "wykryte - niezindeksowane"). Stare adresy
// powiatów przekierowują 301 (routes/pages.js). Ten sam próg MIN_RECORDS -
// strona miasta powstaje tylko tam, gdzie lista jest realnie długa.
function buildCities() {
  const rows = db
    .prepare(
      `SELECT voivodeship, locality, COUNT(*) AS count
         FROM institutions
        WHERE regon NOT IN (SELECT regon FROM institution_optouts)
          AND locality IS NOT NULL AND TRIM(locality) <> ''
        GROUP BY voivodeship, locality
       HAVING count >= @min
        ORDER BY voivodeship, count DESC`
    )
    .all({ min: MIN_RECORDS });

  const out = [];
  for (const r of rows) {
    const voi = voiByValue.get(r.voivodeship);
    if (!voi) continue;
    const citySlug = slugify(r.locality);
    out.push({
      voivodeship: voi,
      localityValue: r.locality,
      citySlug,
      label: displayCase(r.locality),
      count: r.count,
      path: `/baza/wojewodztwo/${voi.slug}/miasto/${citySlug}`,
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

const CITIES = buildCities();
const VOIVODESHIP_TYPES = buildVoivodeshipTypes();

const cityBy = new Map(CITIES.map((c) => [`${c.voivodeship.slug}/${c.citySlug}`, c]));
const voiTypeBy = new Map(VOIVODESHIP_TYPES.map((x) => [`${x.voivodeship.slug}/${x.type.slug}`, x]));

module.exports = {
  MIN_RECORDS,
  cities: () => CITIES,
  voivodeshipTypes: () => VOIVODESHIP_TYPES,
  cityBySlug: (voiSlug, citySlug) => cityBy.get(`${voiSlug}/${citySlug}`) || null,
  voivodeshipTypeBySlug: (voiSlug, typeSlug) => voiTypeBy.get(`${voiSlug}/${typeSlug}`) || null,
  citiesInVoivodeship: (voiSlug) => CITIES.filter((c) => c.voivodeship.slug === voiSlug),
  typesInVoivodeship: (voiSlug) => VOIVODESHIP_TYPES.filter((x) => x.voivodeship.slug === voiSlug),
  voivodeshipsForType: (typeSlug) => VOIVODESHIP_TYPES.filter((x) => x.type.slug === typeSlug),
};
