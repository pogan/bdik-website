// Syntetyczna baza instytucji do testów (npm test, CI). Zastępuje kopię
// prawdziwej bazy: ta jest produktem płatnym, nie ma jej w repo ani w CI,
// a testy na niej zależały od tego, co akurat w niej leży.
//
// Dane są deterministyczne (bez losowości), wymyślone i rozpoznawalne:
// REGON-y z prefiksem 99, adresy e-mail i WWW w domenie example-fixture.pl,
// nazwy "TESTOWY ...". Kształt odpowiada temu, czego potrzebują strony
// segmentów i filtry: 16 województw, kilka miejscowości po >= MIN_RECORDS
// instytucji (lib/geoPages.js), cztery typy z lib/institutionTypes.js plus
// "inne", częściowe pokrycie telefonem / e-mailem / WWW i łącznie ponad
// 2 000 rekordów (licznik "2 000+" na /baza, duże segmenty bez pełnej listy).
const voivodeships = require('../../lib/voivodeships');

const PER_VOIVODESHIP = 140;

// Po trzy miasta i trzy wsie na województwo; nazwy miast prawdziwe (strony
// miast mają realistyczne slugi), żadna nie koliduje z dawnymi slugami powiatów
// używanymi w testach przekierowań (np. lodzkie/powiat/kutnowski).
const CITIES = {
  'DOLNOŚLĄSKIE': ['WROCŁAW', 'LEGNICA', 'WAŁBRZYCH'],
  'KUJAWSKO-POMORSKIE': ['BYDGOSZCZ', 'TORUŃ', 'WŁOCŁAWEK'],
  'LUBELSKIE': ['LUBLIN', 'ZAMOŚĆ', 'CHEŁM'],
  'LUBUSKIE': ['ZIELONA GÓRA', 'GORZÓW WIELKOPOLSKI', 'ŻARY'],
  'ŁÓDZKIE': ['ŁÓDŹ', 'PIOTRKÓW TRYBUNALSKI', 'SKIERNIEWICE'],
  'MAŁOPOLSKIE': ['KRAKÓW', 'TARNÓW', 'NOWY SĄCZ'],
  'MAZOWIECKIE': ['WARSZAWA', 'RADOM', 'PŁOCK'],
  'OPOLSKIE': ['OPOLE', 'NYSA', 'BRZEG'],
  'PODKARPACKIE': ['RZESZÓW', 'PRZEMYŚL', 'KROSNO'],
  'PODLASKIE': ['BIAŁYSTOK', 'SUWAŁKI', 'ŁOMŻA'],
  'POMORSKIE': ['GDAŃSK', 'GDYNIA', 'SŁUPSK'],
  'ŚLĄSKIE': ['KATOWICE', 'GLIWICE', 'BIELSKO-BIAŁA'],
  'ŚWIĘTOKRZYSKIE': ['KIELCE', 'OSTROWIEC ŚWIĘTOKRZYSKI', 'SANDOMIERZ'],
  'WARMIŃSKO-MAZURSKIE': ['OLSZTYN', 'ELBLĄG', 'EŁK'],
  'WIELKOPOLSKIE': ['POZNAŃ', 'KALISZ', 'KONIN'],
  'ZACHODNIOPOMORSKIE': ['SZCZECIN', 'KOSZALIN', 'STARGARD'],
};
const VILLAGES = ['TESTOWA WOLA', 'PRZYKŁADOWO', 'WZOROWICE'];
const PREFIXES = ['GMINNY', 'MIEJSKI', 'POWIATOWY', 'SAMORZĄDOWY'];

// Kolejne reszty z 10 wyznaczają typ: 40% domów kultury, 30% bibliotek,
// po 10% centrów i ośrodków kultury, 10% innych (bez własnej strony typu).
function nameFor(i, place) {
  const n = `NR ${i + 1}`;
  switch (i % 10) {
    case 0: case 1: case 2: case 3:
      return `TESTOWY ${PREFIXES[i % 4]} DOM KULTURY ${n} W ${place}`;
    case 4: case 5: case 6:
      return `TESTOWA MIEJSKA BIBLIOTEKA PUBLICZNA ${n} W ${place}`;
    case 7:
      return `TESTOWE CENTRUM KULTURY ${n} W ${place}`;
    case 8:
      return `TESTOWY GMINNY OŚRODEK KULTURY ${n} W ${place}`;
    default:
      return `TESTOWA GALERIA SZTUKI ${n} W ${place}`;
  }
}

// REGON 9-cyfrowy z poprawną cyfrą kontrolną, zawsze z prefiksem 99.
function regonFor(seq) {
  const body = `99${String(seq).padStart(6, '0')}`;
  const weights = [8, 9, 2, 3, 4, 5, 6, 7];
  const sum = weights.reduce((acc, w, k) => acc + w * Number(body[k]), 0);
  return body + String((sum % 11) % 10);
}

function syntheticInstitutions() {
  const rows = [];
  let seq = 0;
  voivodeships.all().forEach((voi, v) => {
    const places = [...CITIES[voi.value], ...VILLAGES.map((w) => `${w} ${voi.slug.toUpperCase()}`)];
    for (let i = 0; i < PER_VOIVODESHIP; i += 1) {
      seq += 1;
      const place = places[i % places.length];
      const name = nameFor(i, place);
      const phone = i % 7 === 0 ? null : `+48 ${String(10 + v).padStart(2, '0')} 555 ${String(seq).padStart(4, '0')}`;
      const email = i % 5 < 3 ? `biuro${seq}@example-fixture.pl` : null;
      const website = i % 2 === 0 ? `https://instytucja${seq}.example-fixture.pl` : null;
      rows.push({
        regon: regonFor(seq),
        regon_valid: 1,
        primary_source: 'seed',
        name,
        name_normalized: name,
        legal_form: 'SAMORZĄDOWA INSTYTUCJA KULTURY',
        voivodeship: voi.value,
        county: `POWIAT ${place}`,
        commune: place,
        locality: place,
        street: `UL. TESTOWA`,
        building_no: String((i % 50) + 1),
        postal_code: `${String(10 + v).padStart(2, '0')}-${String(i).padStart(3, '0')}`,
        post_office: place,
        phone,
        email,
        website,
        pkd_main_code: i % 10 >= 4 && i % 10 <= 6 ? '91.01.A' : '90.04.Z',
        pkd_main_desc: i % 10 >= 4 && i % 10 <= 6 ? 'DZIAŁALNOŚĆ BIBLIOTEK' : 'DZIAŁALNOŚĆ OBIEKTÓW KULTURALNYCH',
        employment_band: ['0-9', '10-49', '50-249'][i % 3],
        activity_start_date: `${1990 + (i % 30)}-0${(i % 9) + 1}-15`,
        founded_date: `${1990 + (i % 30)}-0${(i % 9) + 1}-01`,
      });
    }
  });
  return rows;
}

function seedSynthetic(db) {
  const rows = syntheticInstitutions();
  const columns = Object.keys(rows[0]);
  const insert = db.prepare(
    `INSERT INTO institutions (${columns.join(', ')}) VALUES (${columns.map((c) => '@' + c).join(', ')})`
  );
  db.transaction(() => rows.forEach((r) => insert.run(r)))();
  return rows.length;
}

module.exports = { seedSynthetic, syntheticInstitutions, regonFor, PER_VOIVODESHIP };
