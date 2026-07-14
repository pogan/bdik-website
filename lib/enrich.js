// Czysta logika agenta uzupełniania danych kontaktowych (bez I/O poza fetch
// w CLI). Warianty adresów WWW, ekstrakcja e-maili/telefonów ze stron,
// deobfuskacja (Cloudflare, [at]/[małpa]), dopasowanie strony do instytucji
// oraz parsowanie wyników wyszukiwarki DuckDuckGo.

const { normalizePhone, normalizedKey } = require('../etl/normalize');

// Funkcjonalne sufiksy drugiego poziomu .pl - nigdy nie obcinamy hosta do
// samego sufiksu (np. bibliotekasuloszowa.pct.net.pl -> pct.net.pl OK,
// -> net.pl już nie).
const PL_PUBLIC_SUFFIXES = new Set([
  'com.pl', 'net.pl', 'org.pl', 'edu.pl', 'gov.pl', 'mil.pl', 'info.pl',
  'biz.pl', 'waw.pl', 'sklep.pl', 'szkola.pl', 'miasta.pl', 'powiat.pl',
  'gmina.pl', 'turystyka.pl', 'media.pl', 'priv.pl', 'nom.pl', 'pc.pl',
  'tm.pl', 'rel.pl', 'sos.pl', 'targi.pl', 'tourism.pl', 'travel.pl',
  'agro.pl', 'aid.pl', 'atm.pl', 'auto.pl', 'gsm.pl', 'mail.pl',
  'nieruchomosci.pl', 'realestate.pl',
]);

// Publiczne skrzynki - domena e-maila nie wskazuje wtedy na stronę instytucji.
const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'wp.pl', 'o2.pl', 'onet.pl', 'onet.eu', 'poczta.onet.pl',
  'pro.onet.pl', 'interia.pl', 'interia.eu', 'op.pl', 'poczta.fm', 'vp.pl',
  'gazeta.pl', 'tlen.pl', 'autograf.pl', 'neostrada.pl', 'buziaczek.pl',
  'go2.pl', 'hot.pl', 'spoko.pl', 'wp.eu', 'hotmail.com', 'yahoo.com',
  'yahoo.pl', 'outlook.com', 'icloud.com', 'aol.com', 'live.com',
]);

// Portale/agregatory - nie są stroną instytucji, odrzucamy w wynikach szukania.
const SEARCH_DOMAIN_BLOCKLIST = [
  'facebook.com', 'instagram.com', 'youtube.com', 'twitter.com', 'x.com',
  'tiktok.com', 'linkedin.com', 'wikipedia.org', 'google.com', 'google.pl',
  'duckduckgo.com', 'panoramafirm.pl', 'pkt.pl', 'firmy.net', 'aleo.com',
  'rejestr.io', 'krs-pobierz.pl', 'mojepanstwo.pl', 'money.pl', 'gowork.pl',
  'nk.pl', 'tripadvisor.com', 'allegro.pl', 'olx.pl', 'baza-firm.com.pl',
  'ngo.pl', 'bip.gov.pl', 'ceidg.gov.pl', 'biznes.gov.pl', 'infoveriti.pl',
  'owg.pl', 'dane.gov.pl', 'polska-firma.com', 'zumi.pl', 'targeo.pl',
];

// Słowa rodzajowe w nazwach instytucji - zbyt częste, by potwierdzały
// dopasowanie strony (każdy GOK ma w nazwie "ośrodek kultury").
const NAME_STOPWORDS = new Set([
  'gminny', 'gminna', 'gminne', 'gminnego', 'miejski', 'miejska', 'miejskie',
  'miejsko', 'wiejski', 'osrodek', 'centrum', 'kultury', 'kultura', 'domu',
  'biblioteka', 'publiczna', 'publicznej', 'gmina', 'gminy', 'miasta',
  'imienia', 'sportu', 'rekreacji', 'turystyki', 'promocji', 'czytelnia',
  'samorzadowy', 'samorzadowa', 'samorzadowe', 'instytucja', 'filia',
  'sztuki', 'muzeum', 'galeria', 'regionalne', 'regionalny', 'powiatowa',
  'powiatowy', 'narodowe', 'narodowy', 'wojewodzka', 'wojewodzki',
]);

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const EMAIL_EXACT_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

// Sygnatury mechanizmów antyspamowych - jeśli występują, a e-maila nie
// wyciągnęliśmy automatycznie, prosimy użytkownika o ręczne przepisanie.
const OBFUSCATION_PATTERNS = [
  /data-cfemail=/i,
  /\/cdn-cgi\/l\/email-protection/i,
  /\[\s*(?:at|małpa|malpa)\s*\]/i,
  /\(\s*(?:at|małpa|malpa)\s*\)/i,
  /\{\s*(?:at|małpa|malpa)\s*\}/i,
  /\bmalpa\b/i,
  /\bemail\s*:?\s*<img/i,
];

function stripDiacritics(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L');
}

function decodeEntities(str) {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

function textFromHtml(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ');
}

// --- Warianty adresu WWW ---------------------------------------------------

function hostIsBareSuffix(host) {
  const labels = host.split('.');
  if (labels.length < 2) return true;
  // np. gdow.pl - rejestrowalna domena; net.pl - goły sufiks funkcjonalny
  if (labels.length === 2) return PL_PUBLIC_SUFFIXES.has(host);
  return false;
}

function minLabels(host) {
  const last2 = host.split('.').slice(-2).join('.');
  return PL_PUBLIC_SUFFIXES.has(last2) ? 3 : 2;
}

// Zwraca listę { url, requiresMatch } do sprawdzenia po kolei.
// requiresMatch=false: oryginał / obcięta podstrona / zdjęte "www." -
// wystarczy, że strona odpowiada. requiresMatch=true: głębsze obcięcie
// subdomeny - wymagamy, by treść strony pasowała do instytucji.
function websiteVariants(rawUrl) {
  let url;
  try {
    let s = String(rawUrl || '').trim();
    if (!s) return [];
    if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
    url = new URL(s);
  } catch {
    return [];
  }
  const variants = [];
  const seen = new Set();
  const push = (u, requiresMatch) => {
    if (!seen.has(u)) {
      seen.add(u);
      variants.push({ url: u, requiresMatch });
    }
  };

  const host = url.hostname.toLowerCase();
  const hasPath = url.pathname !== '/' || url.search !== '';

  push(url.href.replace(/\/+$/, ''), false);
  if (hasPath) push(`${url.protocol}//${host}`, false);

  // zdjęcie / dodanie "www." nie zmienia tożsamości serwisu
  if (host.startsWith('www.')) push(`${url.protocol}//${host.slice(4)}`, false);
  else push(`${url.protocol}//www.${host}`, false);

  // głębsze obcinanie subdomen, po jednej etykiecie, nie poniżej domeny
  // rejestrowalnej (uwaga na sufiksy typu net.pl)
  let labels = (host.startsWith('www.') ? host.slice(4) : host).split('.');
  const floor = minLabels(labels.join('.'));
  while (labels.length > floor) {
    labels = labels.slice(1);
    const h = labels.join('.');
    if (hostIsBareSuffix(h)) break;
    push(`https://${h}`, true);
    push(`https://www.${h}`, true);
  }
  return variants;
}

function hostSansWww(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Czy odpowiedź wylądowała na innym hoście niż żądany (ignorując "www.")?
// Takie przekierowanie wymaga twardego potwierdzenia treści - republika.pl
// przekierowuje na onet.pl, stare domeny gmin na samorzad.gov.pl itd.
function isCrossHostRedirect(requestedUrl, finalUrl) {
  const a = hostSansWww(requestedUrl);
  const b = hostSansWww(finalUrl);
  return Boolean(a) && Boolean(b) && a !== b;
}

// Wartość do zapisania w bazie po udanej weryfikacji: na tym samym hoście
// zapisujemy żądany wariant, ale po przekierowaniu na inny host - PEŁNY
// adres docelowy z podstroną (https://samorzad.gov.pl/web/gmina-miasto-mordy,
// nie bezużyteczne https://samorzad.gov.pl), bez query/hash.
function canonicalWebsiteValue(requestedUrl, finalUrl) {
  if (!isCrossHostRedirect(requestedUrl, finalUrl)) return requestedUrl;
  try {
    const u = new URL(finalUrl);
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return requestedUrl;
  }
}

// --- Dopasowanie strony do instytucji ---------------------------------------

// Rdzeń tokenu odporny na odmianę: "krzeszowice" -> "krzeszowi" dopasuje
// też "w Krzeszowicach".
function tokenStem(token) {
  const t = stripDiacritics(token.toLowerCase());
  return t.length <= 5 ? t : t.slice(0, Math.max(5, t.length - 3));
}

function institutionNeedles(inst) {
  const nameTokens = normalizedKey(inst.name || '')
    .split(' ')
    .filter((t) => t.length >= 5 && !NAME_STOPWORDS.has(t) && !/^\d+$/.test(t));
  const locality = normalizedKey(inst.locality || '');
  return {
    nameStems: [...new Set(nameTokens.map(tokenStem))],
    localityStem: locality && locality.length >= 3 ? tokenStem(locality) : '',
    postalCode: (inst.postal_code || '').trim(),
  };
}

// Strony parkingowe / "domena na sprzedaż" - odpowiadają HTTP 200 i często
// zawierają nazwę miejscowości (w wypisanej nazwie domeny), więc bez tego
// filtra przechodzą dopasowanie treści.
const PARKED_PAGE_PATTERNS = [
  /domen[aęy][^<]{0,40}(na sprzedaż|do kupienia|jest zarejestrowana w)/i,
  /(ta|tę|te) domen[aęy][^<]{0,30}(kup|sprzeda|zarezerw)/i,
  /kup\s+(tę|te)?\s*domenę/i,
  /domain\s+(is\s+)?for\s+sale/i,
  /buy\s+this\s+domain/i,
  /aftermarket\.pl/i,
  /getname\.pl/i,
  /sedoparking|sedo\.com\/parking/i,
  /parked\s+domain|domain\s+parking/i,
  /zarejestruj\s+domenę.*(home\.pl|nazwa\.pl|ovh)/i,
];

function looksLikeParkedPage(html) {
  return PARKED_PAGE_PATTERNS.some((re) => re.test(html));
}

// strict=false: dowolny sygnał (miejscowość / token nazwy / kod pocztowy).
// strict=true (wyniki z wyszukiwarki): wymagamy sygnału lokalizacji ORAZ -
// o ile nazwa ma jakieś charakterystyczne tokeny - także tokenu nazwy.
function htmlMatchesInstitution(html, inst, { strict = false } = {}) {
  const text = stripDiacritics(textFromHtml(html).toLowerCase());
  const { nameStems, localityStem, postalCode } = institutionNeedles(inst);

  const nameHit = nameStems.some((s) => text.includes(s));
  const localityHit = Boolean(localityStem) && text.includes(localityStem);
  const postalHit = Boolean(postalCode) && text.includes(postalCode);
  const locationHit = localityHit || postalHit;

  if (strict) {
    if (!localityStem && !postalCode) return nameHit;
    if (nameStems.length === 0) return locationHit;
    return locationHit && nameHit;
  }
  return nameHit || locationHit;
}

// Najostrzejsze potwierdzenie - do akceptacji OBCEJ domeny (obcięta
// subdomena, wynik wyszukiwarki). Sama miejscowość nie wystarcza, bo portal
// miasta/gminy zawsze ją zawiera (tak https://www.mdkfort49.krakow.pl
// "naprawiło się" na https://krakow.pl). Wymagamy sygnału lokalizacji ORAZ
// niezależnego identyfikatora instytucji: znanego telefonu, e-maila, ulicy
// albo charakterystycznego członu nazwy (nie pochodzącego od miejscowości).
function strongMatchesInstitution(html, inst) {
  if (looksLikeParkedPage(html)) return false;
  const text = stripDiacritics(textFromHtml(html).toLowerCase());
  const { nameStems, localityStem, postalCode } = institutionNeedles(inst);

  const locationHit =
    (Boolean(localityStem) && text.includes(localityStem)) ||
    (Boolean(postalCode) && text.includes(postalCode));
  if (!locationHit) return false;

  // twarde identyfikatory: telefon (ciąg 9 cyfr w cyfrach całej strony) i e-mail
  const phoneDigits = (inst.phone || '').replace(/\D/g, '').replace(/^48/, '').slice(-9);
  if (phoneDigits.length === 9 && text.replace(/\D/g, '').includes(phoneDigits)) return true;
  const email = (inst.email || '').trim().toLowerCase();
  if (email && (text.includes(stripDiacritics(email)) || html.toLowerCase().includes(email))) return true;

  // ulica (bez "ul./al./os.")
  const street = normalizedKey((inst.street || '').replace(/^(ul|al|os|pl)\b\.?/i, ''));
  const streetToken = street.split(' ').find((t) => t.length >= 5);
  if (streetToken && text.includes(tokenStem(streetToken))) return true;

  // charakterystyczny człon nazwy - z wykluczeniem tokenów zbieżnych
  // z miejscowością ("MCK w Leżajsku" vs strona parkingowa "mck.lezajsk.pl");
  // zbieżność liczymy po wspólnym prefiksie, bo odmiana potrafi zmienić
  // końcówkę wewnątrz rdzenia ("Mordy" -> "w Mordach": morda vs mordy)
  const distinctive = nameStems.filter((s) => !stemsRelated(s, localityStem));
  return distinctive.some((s) => text.includes(s));
}

function stemsRelated(a, b) {
  if (!a || !b) return false;
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common += 1;
  return common >= 4 && common >= Math.min(a.length, b.length) - 1;
}

// --- Ekstrakcja e-maili ------------------------------------------------------

// Cloudflare email-protection: hex w data-cfemail / #hash linku, XOR z
// pierwszym bajtem. W pełni deterministyczne, więc odszyfrowujemy sami.
function decodeCfEmail(hex) {
  if (!/^[0-9a-f]{4,}$/i.test(hex) || hex.length % 2 !== 0) return '';
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  const key = bytes[0];
  return String.fromCharCode(...bytes.slice(1).map((b) => b ^ key));
}

function isJunkEmail(email) {
  const e = email.toLowerCase();
  return (
    /\.(png|jpe?g|gif|svg|webp|css|js)$/.test(e) ||
    /(example\.|sentry|wixpress|cloudflare|godaddy|schema\.org|w3\.org|yourdomain|domena\.pl|twojadomena)/.test(e) ||
    e.length > 80
  );
}

function extractEmails(html) {
  const emails = new Set();
  let deobfuscated = 0;

  // 1. Cloudflare email-protection
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) {
    const e = decodeCfEmail(m[1]);
    if (e && EMAIL_EXACT_RE.test(e)) {
      emails.add(e.toLowerCase());
      deobfuscated += 1;
    }
  }
  for (const m of html.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)) {
    const e = decodeCfEmail(m[1]);
    if (e && EMAIL_EXACT_RE.test(e)) {
      emails.add(e.toLowerCase());
      deobfuscated += 1;
    }
  }

  // 2. linki mailto:
  for (const m of html.matchAll(/href=["']mailto:([^"'?]+)/gi)) {
    const e = decodeEntities(m[1]).trim().toLowerCase();
    if (EMAIL_EXACT_RE.test(e)) emails.add(e);
  }

  // 3. zwykły tekst
  const text = textFromHtml(html);
  for (const m of text.matchAll(EMAIL_RE)) emails.add(m[0].toLowerCase());

  // 4. wzorce [at]/[małpa]/[dot]/[kropka] - deterministycznie odwracalne
  const decodedText = text
    .replace(/\s*[[({]\s*(?:at|małpa|malpa)\s*[\])}]\s*/gi, '@')
    .replace(/\s*[[({]\s*(?:dot|kropka)\s*[\])}]\s*/gi, '.');
  if (decodedText !== text) {
    for (const m of decodedText.matchAll(EMAIL_RE)) {
      if (!emails.has(m[0].toLowerCase())) {
        emails.add(m[0].toLowerCase());
        deobfuscated += 1;
      }
    }
  }

  const list = [...emails].filter((e) => !isJunkEmail(e));
  const obfuscationDetected = OBFUSCATION_PATTERNS.some((re) => re.test(html));
  return { emails: list, deobfuscated, obfuscationDetected };
}

// Fragment strony wokół sygnatury antyspamowej - do pokazania użytkownikowi
// przy ręcznym przepisywaniu.
function obfuscationSnippet(html) {
  for (const re of OBFUSCATION_PATTERNS) {
    const m = re.exec(html);
    if (m) {
      const start = Math.max(0, m.index - 120);
      return html.slice(start, m.index + m[0].length + 120).replace(/\s+/g, ' ').trim();
    }
  }
  return '';
}

// Preferencje przy wielu e-mailach: domena zgodna ze stroną, potem typowe
// skrzynki ogólne instytucji, potem pierwszy z brzegu.
const PREFERRED_LOCAL_PARTS = /^(sekretariat|biuro|kontakt|info|gok|mgok|gcok|mok|dom ?kultury|dyrekcja|recepcja|promocja|biblioteka)/;

function pickBestEmail(emails, websiteHost) {
  if (emails.length === 0) return '';
  const host = (websiteHost || '').replace(/^www\./, '');
  const sameDomain = emails.filter((e) => host && e.endsWith(`@${host}`));
  const pool = sameDomain.length > 0 ? sameDomain : emails;
  const preferred = pool.find((e) => PREFERRED_LOCAL_PARTS.test(e.split('@')[0]));
  return preferred || pool[0];
}

// --- Ekstrakcja telefonów ----------------------------------------------------

const PHONE_CONTEXT_BLOCK_RE = /(nip|regon|krs|iban|konto|rachun|bank)/i;

function extractPhones(html) {
  const phones = new Map(); // normalized -> raw (pierwsze wystąpienie)

  const consider = (raw, context = '') => {
    const digits = raw.replace(/\D/g, '');
    let national = '';
    if (digits.length === 9) national = digits;
    else if (digits.length === 11 && digits.startsWith('48')) national = digits.slice(2);
    else if (digits.length === 10 && digits.startsWith('0')) national = digits.slice(1);
    if (!national || national[0] === '0') return;
    if (PHONE_CONTEXT_BLOCK_RE.test(context)) return;
    const normalized = normalizePhone(national);
    if (!phones.has(normalized)) phones.set(normalized, raw.trim());
  };

  for (const m of html.matchAll(/href=["']tel:([^"']+)["']/gi)) consider(decodeEntities(m[1]));

  const text = textFromHtml(html);
  for (const m of text.matchAll(/(?:\+\s*)?[\d(][\d\s().\/-]{6,18}\d/g)) {
    const context = text.slice(Math.max(0, m.index - 30), m.index);
    consider(m[0], context);
  }

  return [...phones.entries()].map(([normalized, raw]) => ({ normalized, raw }));
}

// --- Linki do podstron kontaktowych -----------------------------------------

function contactPageLinks(html, baseUrl) {
  const links = new Set();
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    const href = decodeEntities(m[1]);
    if (!/kontakt|contact/i.test(href)) continue;
    try {
      const u = new URL(href, base);
      if (u.hostname === base.hostname && /^https?:$/.test(u.protocol)) {
        links.add(u.href);
      }
    } catch {
      /* zły href - pomijamy */
    }
    if (links.size >= 2) break;
  }
  return [...links];
}

// --- Wyszukiwarka (DuckDuckGo HTML) -----------------------------------------

function parseDdgResults(html) {
  const urls = [];
  const seen = new Set();
  for (const m of html.matchAll(/class="result__a"[^>]*href="([^"]+)"/gi)) {
    let href = decodeEntities(m[1]);
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (!/^https?:\/\//i.test(href)) continue;
    if (!seen.has(href)) {
      seen.add(href);
      urls.push(href);
    }
  }
  return urls;
}

function isBlockedSearchDomain(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return SEARCH_DOMAIN_BLOCKLIST.some((d) => host === d || host.endsWith(`.${d}`));
}

function pickSearchCandidates(urls, limit = 4) {
  const out = [];
  const seenHosts = new Set();
  for (const url of urls) {
    if (isBlockedSearchDomain(url)) continue;
    let host;
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
    if (seenHosts.has(host)) continue;
    seenHosts.add(host);
    out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

// --- Pomocnicze --------------------------------------------------------------

function emailDomain(email) {
  const at = (email || '').lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).trim().toLowerCase();
}

function isGenericEmailDomain(domain) {
  return GENERIC_EMAIL_DOMAINS.has((domain || '').toLowerCase());
}

module.exports = {
  websiteVariants,
  htmlMatchesInstitution,
  strongMatchesInstitution,
  looksLikeParkedPage,
  isCrossHostRedirect,
  canonicalWebsiteValue,
  institutionNeedles,
  extractEmails,
  extractPhones,
  pickBestEmail,
  obfuscationSnippet,
  decodeCfEmail,
  contactPageLinks,
  parseDdgResults,
  pickSearchCandidates,
  emailDomain,
  isGenericEmailDomain,
  textFromHtml,
  decodeEntities,
};
