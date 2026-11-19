// Opinie klientów na /baza. Prawdziwe opinie, zebrane przez Karola, ze zgodą
// klientów na publikację (na stronie; Hubert Baumann - tylko strona, bez social
// mediów). Teksty sparafrazowane za zgodą klientów, bez dopisywania faktów.
// Zdjęcia: public/images/opinie/<slug>-{160,320}.webp, kwadrat, bez metadanych.
const TESTIMONIALS = [
  {
    slug: 'zofia-kaleta',
    name: 'Zofia Kaleta',
    role: 'zespół VATRA, Gdańsk',
    quote:
      'Wybór i zakup danych zajął chwilę i obył się bez problemów. Z gotowym plikiem i narzędziami AI ' +
      'w jeden dzień przygotowałam i wysłałam zapytania, na które normalnie potrzebowałabym miesiąca.',
  },
  {
    slug: 'hubert-baumann',
    name: 'dr Hubert Baumann',
    role: 'booking manager i manager muzyczny, Gdańsk',
    quote:
      'Z BDIK zbudowałem katalog sal koncertowych i na tej podstawie wysyłam oferty zespołów, ' +
      'z którymi pracuję. Zajęło mi to dużo mniej czasu.',
  },
  {
    slug: 'milena-marczykowska',
    name: 'Milena Marczykowska',
    role: 'event manager klubu Peron 5, artystka nowocyrkowa',
    quote:
      'W BDIK znalazłam instytucje kultury, które zostały partnerami wydarzeń artystycznych, jakie organizuję.',
  },
];

function all() {
  return TESTIMONIALS;
}

module.exports = { all };
