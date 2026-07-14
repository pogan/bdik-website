const test = require('node:test');
const assert = require('node:assert/strict');

const {
  websiteVariants,
  htmlMatchesInstitution,
  strongMatchesInstitution,
  looksLikeParkedPage,
  isCrossHostRedirect,
  canonicalWebsiteValue,
  extractEmails,
  extractPhones,
  pickBestEmail,
  decodeCfEmail,
  contactPageLinks,
  parseDdgResults,
  pickSearchCandidates,
  emailDomain,
  isGenericEmailDomain,
} = require('../lib/enrich');

// --- websiteVariants ---------------------------------------------------------

test('websiteVariants: obcina podstronę i subdomeny w kolejności', () => {
  const v = websiteVariants('https://www.sok.alwernia.pl/http');
  const urls = v.map((x) => x.url);
  assert.equal(urls[0], 'https://www.sok.alwernia.pl/http');
  assert.ok(urls.includes('https://www.sok.alwernia.pl'));
  assert.ok(urls.includes('https://sok.alwernia.pl'));
  assert.ok(urls.includes('https://alwernia.pl'));
  // oryginał, obcięta podstrona i zdjęcie www nie wymagają dopasowania treści
  assert.equal(v[0].requiresMatch, false);
  assert.equal(v.find((x) => x.url === 'https://sok.alwernia.pl').requiresMatch, false);
  // głębsze obcięcie subdomeny wymaga dopasowania treści do instytucji
  assert.equal(v.find((x) => x.url === 'https://alwernia.pl').requiresMatch, true);
});

test('websiteVariants: nie schodzi poniżej sufiksu funkcjonalnego (net.pl)', () => {
  const urls = websiteVariants('https://biblioteka.pct.net.pl').map((x) => x.url);
  assert.ok(urls.includes('https://pct.net.pl'));
  assert.ok(!urls.includes('https://net.pl'));
  assert.ok(!urls.includes('https://www.net.pl'));
});

test('websiteVariants: dokleja protokół, śmieciowe wejście daje pustą listę', () => {
  assert.equal(websiteVariants('gok.example.pl')[0].url, 'https://gok.example.pl');
  assert.deepEqual(websiteVariants(''), []);
  assert.deepEqual(websiteVariants('https://nie posiada'), []);
});

// --- ekstrakcja e-maili --------------------------------------------------------

test('extractEmails: tekst, mailto i filtr śmieci', () => {
  const html = `
    <p>Kontakt: sekretariat@gok.pl</p>
    <a href="mailto:dyrektor@gok.pl?subject=x">napisz</a>
    <img src="logo@2x.png">
    <span>ktos@example.com</span>
  `;
  const { emails } = extractEmails(html);
  assert.ok(emails.includes('sekretariat@gok.pl'));
  assert.ok(emails.includes('dyrektor@gok.pl'));
  assert.ok(!emails.some((e) => e.endsWith('.png')));
  assert.ok(!emails.includes('ktos@example.com'));
});

test('extractEmails: odszyfrowuje Cloudflare data-cfemail', () => {
  const email = 'gok@kultura.pl';
  const key = 0x42;
  const hex = [key, ...[...email].map((c) => c.charCodeAt(0) ^ key)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  assert.equal(decodeCfEmail(hex), email);
  const res = extractEmails(`<a data-cfemail="${hex}" href="#">[email protected]</a>`);
  assert.ok(res.emails.includes(email));
  assert.ok(res.deobfuscated >= 1);
});

test('extractEmails: odszyfrowuje wzorce [at]/[kropka] i (małpa)', () => {
  const res = extractEmails('<p>Napisz: biuro [at] mgok [kropka] pl lub info(małpa)dom.pl</p>');
  assert.ok(res.emails.includes('biuro@mgok.pl'));
  assert.ok(res.emails.includes('info@dom.pl'));
  assert.ok(res.deobfuscated >= 2);
});

test('extractEmails: wykrywa antyspam, którego nie umie odczytać', () => {
  const res = extractEmails('<a data-cfemail="zz">[email protected]</a>');
  assert.equal(res.emails.length, 0);
  assert.equal(res.obfuscationDetected, true);
});

// --- ekstrakcja telefonów --------------------------------------------------------

test('extractPhones: tel:, tekst z +48, deduplikacja', () => {
  const html = `
    <a href="tel:+48123456789">zadzwoń</a>
    <p>tel. +48 12 345 67 89, kom. 609 123 456</p>
  `;
  const phones = extractPhones(html);
  const normalized = phones.map((p) => p.normalized);
  assert.deepEqual(normalized, ['+48123456789', '+48609123456']);
});

test('extractPhones: nie łapie REGON-u/NIP-u ani numerów kont', () => {
  const html = '<p>REGON: 123456789, NIP 593 247 24 50, konto 12 3456 7890</p>';
  assert.deepEqual(extractPhones(html), []);
});

// --- wybór najlepszego e-maila -----------------------------------------------------

test('pickBestEmail: preferuje domenę strony, potem typowe skrzynki', () => {
  const emails = ['jan.kowalski@gmail.com', 'sekretariat@gok.pl', 'x@gok.pl'];
  assert.equal(pickBestEmail(emails, 'www.gok.pl'), 'sekretariat@gok.pl');
  assert.equal(pickBestEmail(['a@obca.pl', 'biuro@inna.pl'], 'www.gok.pl'), 'biuro@inna.pl');
  assert.equal(pickBestEmail([], 'www.gok.pl'), '');
});

// --- dopasowanie strony do instytucji ----------------------------------------------

const INST = {
  name: 'Gminny Ośrodek Kultury w Krzeszowicach',
  locality: 'Krzeszowice',
  postal_code: '32-065',
};

test('htmlMatchesInstitution: odmieniona miejscowość wystarcza (tryb luźny)', () => {
  const html = '<h1>Witamy w Krzeszowicach!</h1>';
  assert.equal(htmlMatchesInstitution(html, INST), true);
});

test('htmlMatchesInstitution: tryb strict wymaga lokalizacji', () => {
  const generic = '<h1>Gminny Ośrodek Kultury</h1><p>Zapraszamy!</p>';
  assert.equal(htmlMatchesInstitution(generic, INST, { strict: true }), false);
  const good = '<h1>GOK Krzeszowice</h1><p>ul. Legionów, 32-065</p>';
  assert.equal(htmlMatchesInstitution(good, INST, { strict: true }), true);
  const other = '<h1>Urząd Miasta w Bochni</h1>';
  assert.equal(htmlMatchesInstitution(other, INST), false);
});

test('strongMatchesInstitution: portal miasta NIE przechodzi mimo miejscowości', () => {
  const mdk = {
    name: 'MŁODZIEŻOWY DOM KULTURY FORT 49 "KRZESŁAWICE" W KRAKOWIE',
    locality: 'KRAKÓW',
    postal_code: '31-704',
    phone: '126453247',
    email: 'mdkfort49@mjo.krakow.pl',
    street: 'OS. NA STOKU',
  };
  // portal krakow.pl: mnóstwo treści o Krakowie, zero identyfikatorów MDK
  const cityPortal = '<h1>Magiczny Kraków</h1><p>Aktualności miasta Krakowa, inwestycje, komunikacja.</p>';
  assert.equal(strongMatchesInstitution(cityPortal, mdk), false);
  // prawdziwa strona MDK: miejscowość + znany e-mail
  const own = '<h1>MDK Fort 49 Krzesławice</h1><p>Kraków, mdkfort49@mjo.krakow.pl</p>';
  assert.equal(strongMatchesInstitution(own, mdk), true);
  // miejscowość + znany telefon w innym formacie też wystarcza
  const withPhone = '<p>Zapraszamy do Krakowa! tel. 12 645 32 47</p>';
  assert.equal(strongMatchesInstitution(withPhone, mdk), true);
});

test('strongMatchesInstitution: parking domeny odpada, nawet z nazwą w treści', () => {
  const mck = { name: 'MIEJSKIE CENTRUM KULTURY W LEŻAJSKU', locality: 'LEŻAJSK', postal_code: '', phone: '', email: '', street: '' };
  const parked = '<h1>mck.lezajsk.pl</h1><p>Domena jest na sprzedaż w serwisie AFTERMARKET.PL</p>';
  assert.equal(looksLikeParkedPage(parked), true);
  assert.equal(strongMatchesInstitution(parked, mck), false);
});

test('strongMatchesInstitution: token nazwy zbieżny z miejscowością nie wystarcza', () => {
  const gok = { name: 'GMINNY OŚRODEK KULTURY W RYMANOWIE', locality: 'RYMANÓW', postal_code: '', phone: '', email: '', street: '' };
  // portal gminy: miejscowość obecna, ale brak niezależnego identyfikatora
  const gminaPortal = '<h1>Gmina Rymanów</h1><p>Urząd Gminy w Rymanowie zaprasza.</p>';
  assert.equal(strongMatchesInstitution(gminaPortal, gok), false);
});

test('canonicalWebsiteValue: przekierowanie na inny host zachowuje podstronę', () => {
  // corner case Mordów: mordy.pl -> samorzad.gov.pl/web/gmina-miasto-mordy/
  assert.equal(
    canonicalWebsiteValue('https://mordy.pl', 'https://samorzad.gov.pl/web/gmina-miasto-mordy/'),
    'https://samorzad.gov.pl/web/gmina-miasto-mordy'
  );
  // ten sam host (także z/bez www) -> zostaje żądany wariant
  assert.equal(canonicalWebsiteValue('https://gok.pl', 'https://www.gok.pl/home/'), 'https://gok.pl');
  assert.equal(isCrossHostRedirect('https://www.republika.pl', 'https://www.onet.pl/'), true);
  assert.equal(isCrossHostRedirect('https://gok.pl', 'https://www.gok.pl/'), false);
});

test('strongMatchesInstitution: odmieniona miejscowość w nazwie nie robi za token charakterystyczny', () => {
  const mgok = { name: 'MIEJSKO-GMINNY OŚRODEK KULTURY W MORDACH', locality: 'MORDY', postal_code: '', phone: '', email: '', street: '' };
  // "w Mordach" -> stem "morda" vs locality "mordy": wspólny prefiks, to nie
  // jest niezależny identyfikator - strona gminy nie może przejść tylko dzięki niemu
  const gminaPortal = '<h1>Gmina Miasto Mordy</h1><p>Serwis samorządowy. Witamy w Mordach.</p>';
  assert.equal(strongMatchesInstitution(gminaPortal, mgok), false);
  // ale znana ulica instytucji już wystarcza jako niezależny sygnał
  const withStreet = { ...mgok, street: 'UL. PARKOWA' };
  const pageWithStreet = '<h1>Gmina Miasto Mordy</h1><p>MGOK, ul. Parkowa 9</p>';
  assert.equal(strongMatchesInstitution(pageWithStreet, withStreet), true);
});

// --- podstrony kontaktowe -----------------------------------------------------------

test('contactPageLinks: absolutyzuje i pilnuje hosta', () => {
  const html = `
    <a href="/kontakt">Kontakt</a>
    <a href="https://obcy.pl/kontakt">obcy</a>
    <a href="onas.html">o nas</a>
  `;
  assert.deepEqual(contactPageLinks(html, 'https://gok.pl/'), ['https://gok.pl/kontakt']);
});

// --- wyszukiwarka -------------------------------------------------------------------

test('parseDdgResults: dekoduje linki uddg', () => {
  const html =
    '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgok.pl%2F&amp;rut=abc">GOK</a>' +
    '<a class="result__a" href="https://mok.pl/">MOK</a>';
  assert.deepEqual(parseDdgResults(html), ['https://gok.pl/', 'https://mok.pl/']);
});

test('pickSearchCandidates: odrzuca portale i duplikaty hostów', () => {
  const urls = [
    'https://www.facebook.com/gokkrzeszowice',
    'https://pl.wikipedia.org/wiki/GOK',
    'https://gok.pl/kontakt',
    'https://www.gok.pl/',
    'https://panoramafirm.pl/gok',
  ];
  assert.deepEqual(pickSearchCandidates(urls), ['https://gok.pl/kontakt']);
});

// --- domeny e-mail ------------------------------------------------------------------

test('emailDomain / isGenericEmailDomain', () => {
  assert.equal(emailDomain('Biuro@GOK.PL'), 'gok.pl');
  assert.equal(isGenericEmailDomain('gmail.com'), true);
  assert.equal(isGenericEmailDomain('gok.pl'), false);
});
