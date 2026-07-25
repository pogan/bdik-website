// Statyczna lista 16 województw zamiast wyprowadzania slugów dynamicznie z
// bazy: wartości są stałe i rzadko się zmieniają, a ręczny przegląd usuwa
// ryzyko niejednoznacznej/kolidującej transliteracji polskich znaków przy
// starcie serwera. `value` MUSI dokładnie odpowiadać wartości w kolumnie
// institutions.voivodeship (WIELKIE LITERY, jak w danych GUS/KRS).
const VOIVODESHIPS = [
  { value: 'DOLNOŚLĄSKIE', slug: 'dolnoslaskie', label: 'Dolnośląskie', locative: 'dolnośląskim' },
  { value: 'KUJAWSKO-POMORSKIE', slug: 'kujawsko-pomorskie', label: 'Kujawsko-Pomorskie', locative: 'kujawsko-pomorskim' },
  { value: 'LUBELSKIE', slug: 'lubelskie', label: 'Lubelskie', locative: 'lubelskim' },
  { value: 'LUBUSKIE', slug: 'lubuskie', label: 'Lubuskie', locative: 'lubuskim' },
  { value: 'ŁÓDZKIE', slug: 'lodzkie', label: 'Łódzkie', locative: 'łódzkim' },
  { value: 'MAŁOPOLSKIE', slug: 'malopolskie', label: 'Małopolskie', locative: 'małopolskim' },
  { value: 'MAZOWIECKIE', slug: 'mazowieckie', label: 'Mazowieckie', locative: 'mazowieckim' },
  { value: 'OPOLSKIE', slug: 'opolskie', label: 'Opolskie', locative: 'opolskim' },
  { value: 'PODKARPACKIE', slug: 'podkarpackie', label: 'Podkarpackie', locative: 'podkarpackim' },
  { value: 'PODLASKIE', slug: 'podlaskie', label: 'Podlaskie', locative: 'podlaskim' },
  { value: 'POMORSKIE', slug: 'pomorskie', label: 'Pomorskie', locative: 'pomorskim' },
  { value: 'ŚLĄSKIE', slug: 'slaskie', label: 'Śląskie', locative: 'śląskim' },
  { value: 'ŚWIĘTOKRZYSKIE', slug: 'swietokrzyskie', label: 'Świętokrzyskie', locative: 'świętokrzyskim' },
  { value: 'WARMIŃSKO-MAZURSKIE', slug: 'warminsko-mazurskie', label: 'Warmińsko-Mazurskie', locative: 'warmińsko-mazurskim' },
  { value: 'WIELKOPOLSKIE', slug: 'wielkopolskie', label: 'Wielkopolskie', locative: 'wielkopolskim' },
  { value: 'ZACHODNIOPOMORSKIE', slug: 'zachodniopomorskie', label: 'Zachodniopomorskie', locative: 'zachodniopomorskim' },
];

const BY_SLUG = new Map(VOIVODESHIPS.map((v) => [v.slug, v]));

function bySlug(slug) {
  return BY_SLUG.get(slug) || null;
}

function all() {
  return VOIVODESHIPS;
}

module.exports = { VOIVODESHIPS, bySlug, all };
