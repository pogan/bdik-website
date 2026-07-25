// Typ instytucji (dom/centrum/ośrodek kultury, biblioteka) - nie ma osobnej
// kolumny w bazie (99,6% rekordów ma ten sam legal_form, patrz db/schema.sql),
// więc wyprowadzamy go z nazwy. Ten sam wzorzec co CONTACT_CONDITIONS w
// lib/query.js: klucz filtra -> gotowy warunek SQL, wartość filtra nigdy nie
// trafia do zapytania jako tekst użytkownika.
//
// Dopasowanie jest podzbiorem po nazwie, nie rozłącznym podziałem - kilka
// rekordów pasuje do więcej niż jednego wzorca (np. "...OŚRODEK KULTURY I
// DOM KULTURY..."), a ok. 7% rekordów (galerie, fundacje, "fora kultury" itd.)
// nie pasuje do żadnego z czterech wzorców. Świadoma decyzja: te rekordy
// zostają widoczne w narzędziu i na stronach województw, ale bez własnej,
// dedykowanej strony /baza/typ/... - kategoria byłaby zbyt niejednorodna
// i bez realnego zapytania wyszukiwania.
const TYPE_DEFS = [
  {
    slug: 'domy-kultury',
    condition: "name LIKE '%DOM KULTURY%'",
    label: 'Domy kultury',
    singular: 'dom kultury',
    plural: 'domów kultury',
  },
  {
    slug: 'centra-kultury',
    condition: "name LIKE '%CENTRUM KULTURY%'",
    label: 'Centra kultury',
    singular: 'centrum kultury',
    plural: 'centrów kultury',
  },
  {
    slug: 'osrodki-kultury',
    condition: "name LIKE '%OŚRODEK KULTURY%'",
    label: 'Ośrodki kultury',
    singular: 'ośrodek kultury',
    plural: 'ośrodków kultury',
  },
  {
    slug: 'biblioteki',
    condition: "name LIKE '%BIBLIOTEK%'",
    label: 'Biblioteki',
    singular: 'biblioteka',
    plural: 'bibliotek',
  },
];

const TYPE_CONDITIONS = Object.fromEntries(TYPE_DEFS.map((t) => [t.slug, t.condition]));
const TYPE_FILTER_VALUES = TYPE_DEFS.map((t) => t.slug);
const BY_SLUG = new Map(TYPE_DEFS.map((t) => [t.slug, t]));

function bySlug(slug) {
  return BY_SLUG.get(slug) || null;
}

function all() {
  return TYPE_DEFS;
}

module.exports = { TYPE_DEFS, TYPE_CONDITIONS, TYPE_FILTER_VALUES, bySlug, all };
