// Czytelna pisownia nazw i adresów na stronach publicznych. Źródła (RIK, REGON)
// podają wszystko WIELKIMI LITERAMI i tak zostaje w bazie (ETL, eksport) -
// zamiana dotyczy wyłącznie wyświetlania: "GMINNY OŚRODEK KULTURY I SPORTU
// W KRZYŻANOWIE" -> "Gminny Ośrodek Kultury i Sportu w Krzyżanowie".
//
// Reguły celowo proste: każde słowo wielką literą (także człony po myślniku
// i po cudzysłowie), spójniki/przyimki i skróty typu "im.", "ul." małą (poza
// pierwszym słowem), liczebniki rzymskie i znane skrótowce bez zmian.

const SMALL_WORDS = new Set([
  'i', 'w', 'we', 'z', 'ze', 'na', 'do', 'dla', 'od', 'pod', 'przy', 'nad', 'oraz', 'o', 'u',
  'im.', 'm.st.', 'ul.', 'al.', 'pl.', 'os.', 'gen.', 'prof.', 'ks.', 'św.', 'bp.', 'kard.', 'dr', 'dr.', 'mjr.', 'płk.',
]);

// Skróty adresowe zostają małą literą także na początku ("ul. Długa").
const ADDRESS_PREFIXES = new Set(['ul.', 'al.', 'pl.', 'os.']);

const ACRONYMS = new Set(['GOK', 'MOK', 'MGOK', 'MDK', 'GCK', 'MCK', 'CK', 'PTTK', 'ZHP', 'RP', 'PRL', 'BWA', 'OSP', 'KGW']);

const ROMAN = /^(?=[IVXLC]{2,}$)(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/;

function capitalizeParts(word) {
  // Wielka litera na początku i po cudzysłowie/nawiasie oraz po myślniku
  // poprzedzonym literą lub cudzysłowem ("Bielsko-Biała", '"Łowicka"-Dom', ale "3-go").
  return word.replace(/(^[-"„“(]*|["„“(]|(?<=[\p{L}"”])-)(\p{L})/gu, (_, pre, ch) => pre + ch.toLocaleUpperCase('pl'));
}

function displayCase(value) {
  if (value == null) return value;
  const text = String(value)
    .trim()
    // "IM.ALICJI" -> "IM. ALICJI" - brak spacji po skrócie to częsty błąd w rejestrze.
    .replace(/(?<!\p{L})(IM|UL|AL|GEN|PROF|KS|ŚW)\.(?=\p{L})/gu, '$1. ')
    // "M. ST. WARSZAWY" / "M.ST.WARSZAWY" -> jeden token "m.st." (miasto stołeczne).
    .replace(/(?<!\p{L})M\.\s*ST\.\s*/gu, 'M.ST. ')
    .replace(/\s+/g, ' ');
  if (!text) return text;
  // Tekst już pisany mieszanymi literami zostawiamy - ktoś go świadomie zapisał.
  if (text !== text.toLocaleUpperCase('pl')) return text;

  return text
    .split(' ')
    .map((token, i) => {
      if (ROMAN.test(token) || ACRONYMS.has(token)) return token;
      const lower = token.toLocaleLowerCase('pl');
      if ((i > 0 && SMALL_WORDS.has(lower)) || (i === 0 && ADDRESS_PREFIXES.has(lower))) return lower;
      return capitalizeParts(lower);
    })
    .join(' ');
}

module.exports = { displayCase };
