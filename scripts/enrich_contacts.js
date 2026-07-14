#!/usr/bin/env node
// Agent uzupełniania danych kontaktowych (WWW, telefon, e-mail).
//
// Fazy:
//   1. Weryfikacja istniejących adresów WWW; naprawa przez obcięcie
//      podstron/subdomen (www.x.pl/kontakt -> www.x.pl -> x.pl).
//   2. Wyprowadzenie WWW z domeny e-maila (jeśli domena własna, nie gmail/wp).
//   3. Uzupełnienie telefonu/e-maila ze strony instytucji (+ podstrony
//      "kontakt"). Wartości schowane za antyspamem: Cloudflare i [at]/[małpa]
//      odszyfrowujemy automatycznie; nieodczytywalne -> prompt do ręcznego
//      przepisania (w trybie nieinteraktywnym: kolejka data/enrich_review.json).
//   4. Dla wpisów wciąż niekompletnych: wyszukiwarka (DuckDuckGo) po nazwie
//      i/lub adresie pocztowym.
//
// Użycie: node scripts/enrich_contacts.js [--dry-run] [--limit N]
//         [--no-search] [--search-limit N] [--only-search] [--retry-search]
//         [--search-cooldown DNI] [--concurrency N] [--timeout MS]
//
// Faza 4 prowadzi dziennik prób (tabela web_enrich_attempts): każda
// UKOŃCZONA próba wyszukiwania zapisuje się od razu, więc po przerwaniu
// (blokada wyszukiwarki) kolejne uruchomienie pomija wpisy próbowane
// w ciągu ostatnich --search-cooldown dni (domyślnie 14) i kontynuuje od
// nietkniętych. --retry-search ignoruje dziennik, --only-search pomija
// fazy 1-3 (przydatne przy dobijaniu wyszukiwarki po blokadzie).

require('dotenv').config();

// Stare strony instytucji kultury notorycznie mają wygasłe/zepsute
// certyfikaty. Pobieramy wyłącznie publiczne strony (bez uwierzytelniania),
// więc wyłączenie walidacji TLS jest tu akceptowalne.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');

const db = require('../db');
const { normalizePhone, normalizeWebsite, normalizeEmail } = require('../etl/normalize');
const { fetchPage: fetchPageBase, tryUrl: tryUrlBase } = require('../lib/fetchPage');
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
  obfuscationSnippet,
  contactPageLinks,
  parseDdgResults,
  pickSearchCandidates,
  emailDomain,
  isGenericEmailDomain,
} = require('../lib/enrich');

// --- Argumenty ---------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? Number(args[i + 1]) : def;
};

const DRY_RUN = flag('--dry-run');
const NO_SEARCH = flag('--no-search');
const ONLY_SEARCH = flag('--only-search');
const RETRY_SEARCH = flag('--retry-search');
const LIMIT = opt('--limit', Infinity);
const SEARCH_LIMIT = opt('--search-limit', Infinity);
const SEARCH_COOLDOWN_DAYS = opt('--search-cooldown', 14);
const CONCURRENCY = opt('--concurrency', 8);
const TIMEOUT_MS = opt('--timeout', 10000);

const REVIEW_PATH = path.join(__dirname, '..', 'data', 'enrich_review.json');
const REPORT_PATH = path.join(__dirname, '..', 'data', 'enrich_report.json');

// --- Statystyki i raport -------------------------------------------------------

const stats = {
  www_checked: 0,
  www_ok: 0,
  www_fixed: 0,
  www_dead: 0,
  www_from_email_tried: 0,
  www_from_email_filled: 0,
  www_from_search_tried: 0,
  www_from_search_filled: 0,
  contact_pages_visited: 0,
  phone_tried: 0,
  phone_filled: 0,
  email_tried: 0,
  email_filled: 0,
  email_deobfuscated: 0,
  prompts_shown: 0,
  prompts_answered: 0,
  prompts_skipped: 0,
  review_queued: 0,
  search_queries: 0,
  search_blocked: 0,
  search_skipped_after_block: 0,
  search_skipped_recent: 0,
};

const report = {
  started_at: new Date().toISOString(),
  dry_run: DRY_RUN,
  changes: [],
  dead_websites: [],
  review: [],
};

// --- Zapis do bazy --------------------------------------------------------------

const updWebsite = db.prepare(
  "UPDATE institutions SET website = @website, updated_at = datetime('now') WHERE id = @id"
);
const updPhone = db.prepare(
  "UPDATE institutions SET phone = @phone, phone_normalized = @phone_normalized, updated_at = datetime('now') WHERE id = @id"
);
const updEmail = db.prepare(
  "UPDATE institutions SET email = @email, updated_at = datetime('now') WHERE id = @id"
);
const upsertSource = db.prepare(`
  INSERT INTO institution_sources (institution_id, source) VALUES (?, 'web_enrich')
  ON CONFLICT(institution_id, source) DO UPDATE SET last_seen = datetime('now')
`);

// Dziennik prób fazy 4 - dzięki niemu przerwany przebieg (blokada
// wyszukiwarki) nie zaczyna następnym razem od zera na tych samych wpisach.
db.exec(`
  CREATE TABLE IF NOT EXISTS web_enrich_attempts (
    regon TEXT PRIMARY KEY,
    attempted_at TEXT NOT NULL,
    outcome TEXT NOT NULL
  )
`);
const upsertAttempt = db.prepare(`
  INSERT INTO web_enrich_attempts (regon, attempted_at, outcome) VALUES (@regon, @attempted_at, @outcome)
  ON CONFLICT(regon) DO UPDATE SET attempted_at = @attempted_at, outcome = @outcome
`);
const allAttempts = () => new Map(db.prepare('SELECT regon, attempted_at, outcome FROM web_enrich_attempts').all().map((r) => [r.regon, r]));

function recordChange(inst, field, oldValue, newValue, how) {
  report.changes.push({ regon: inst.regon, name: inst.name, field, old: oldValue || '', new: newValue, how });
  const prefix = DRY_RUN ? '[DRY] ' : '';
  console.log(`${prefix}[${field.toUpperCase()}] ${inst.name} (${inst.locality || '?'}): ${oldValue || '(brak)'} -> ${newValue}  (${how})`);
  if (!DRY_RUN) upsertSource.run(inst.id);
}

function applyWebsite(inst, newValue, how) {
  const value = normalizeWebsite(newValue);
  recordChange(inst, 'website', inst.website, value, how);
  if (!DRY_RUN) updWebsite.run({ id: inst.id, website: value });
  inst.website = value;
}

function applyPhone(inst, raw, how) {
  const normalized = normalizePhone(raw);
  recordChange(inst, 'phone', inst.phone, raw, how);
  if (!DRY_RUN) updPhone.run({ id: inst.id, phone: raw, phone_normalized: normalized });
  inst.phone = raw;
  stats.phone_filled += 1;
}

function applyEmail(inst, raw, how) {
  const value = normalizeEmail(raw);
  recordChange(inst, 'email', inst.email, value, how);
  if (!DRY_RUN) updEmail.run({ id: inst.id, email: value });
  inst.email = value;
  stats.email_filled += 1;
}

// --- Pobieranie stron (lib/fetchPage) -----------------------------------------

const fetchPage = (url) => fetchPageBase(url, { timeoutMs: TIMEOUT_MS });
const tryUrl = (url, retryOnce = false) => tryUrlBase(url, { timeoutMs: TIMEOUT_MS, retryOnce });

// --- Faza 1: weryfikacja WWW -----------------------------------------------------

// Zwraca { status: 'ok'|'fixed'|'dead', pageUrl, html, newValue?, lastStatus }
async function resolveWebsite(inst) {
  const variants = websiteVariants(inst.website);
  let lastStatus = null;
  let suggestion = null;
  for (let i = 0; i < variants.length; i++) {
    const { url, requiresMatch } = variants[i];
    // oryginalny adres dostaje jedno ponowienie - przejściowy timeout nie
    // może wysłać działającej strony do "naprawy" na obcej domenie
    const page = await tryUrl(url, i === 0);
    lastStatus = page.status || page.error;
    if (!page.ok || !page.html) continue;
    if (looksLikeParkedPage(page.html)) continue;
    // Obca domena wymaga twardego potwierdzenia treści - zarówno obcięta
    // subdomena, jak i przekierowanie na inny host (republika.pl -> onet.pl,
    // domena gminy -> samorzad.gov.pl).
    const crossHost = isCrossHostRedirect(url, page.finalUrl);
    if ((requiresMatch || crossHost) && !strongMatchesInstitution(page.html, inst)) {
      // kandydat powiązany, ale bez twardego identyfikatora (np. strona
      // gminy) - nie zapisujemy sami, proponujemy do ręcznej decyzji
      if (!suggestion && htmlMatchesInstitution(page.html, inst)) {
        suggestion = canonicalWebsiteValue(url, page.finalUrl);
      }
      continue;
    }
    if (i === 0 && !crossHost) return { status: 'ok', pageUrl: page.finalUrl, html: page.html, lastStatus };
    // naprawa: ten sam host -> działający wariant; inny host -> pełny adres
    // docelowy z podstroną (goły origin portalu typu samorzad.gov.pl jest
    // bezużyteczny)
    const newValue = canonicalWebsiteValue(url, page.finalUrl);
    if (i === 0 && newValue === url) return { status: 'ok', pageUrl: page.finalUrl, html: page.html, lastStatus };
    return { status: 'fixed', pageUrl: page.finalUrl, html: page.html, newValue, lastStatus };
  }
  return { status: 'dead', pageUrl: '', html: '', lastStatus, suggestion };
}

// --- Ekstrakcja kontaktów ze strony ------------------------------------------------

async function collectContactPages(startUrl, startHtml) {
  const pages = [{ url: startUrl, html: startHtml }];
  const links = contactPageLinks(startHtml, startUrl);
  if (links.length === 0) {
    try {
      links.push(new URL('/kontakt', startUrl).href);
    } catch {
      /* zły URL bazowy */
    }
  }
  for (const link of links.slice(0, 2)) {
    const page = await tryUrl(link);
    stats.contact_pages_visited += 1;
    if (page.ok && page.html) pages.push({ url: page.finalUrl, html: page.html });
  }
  return pages;
}

function harvestContacts(pages, websiteHost) {
  const allEmails = new Set();
  const allPhones = [];
  let deobfuscated = 0;
  let obfuscation = null;
  for (const { url, html } of pages) {
    const e = extractEmails(html);
    e.emails.forEach((x) => allEmails.add(x));
    deobfuscated += e.deobfuscated;
    if (e.obfuscationDetected && e.emails.length === 0 && !obfuscation) {
      obfuscation = { url, snippet: obfuscationSnippet(html) };
    }
    for (const p of extractPhones(html)) {
      if (!allPhones.some((x) => x.normalized === p.normalized)) allPhones.push(p);
    }
  }
  return {
    email: pickBestEmail([...allEmails], websiteHost),
    phone: allPhones[0] || null,
    deobfuscated,
    obfuscation,
  };
}

// --- Prompt o ręczne przepisanie ---------------------------------------------------

let rl = null;
function getReadline() {
  if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return rl;
}

async function promptManual(inst, field, obfuscation) {
  if (DRY_RUN || !process.stdin.isTTY) {
    stats.review_queued += 1;
    report.review.push({
      regon: inst.regon,
      name: inst.name,
      locality: inst.locality,
      field,
      url: obfuscation.url,
      snippet: obfuscation.snippet,
    });
    console.log(`  [?] ${inst.name}: ${field} za antyspamem - dopisano do kolejki przeglądu (${obfuscation.url})`);
    return;
  }
  stats.prompts_shown += 1;
  console.log('\n--- WYMAGANE RĘCZNE PRZEPISANIE -------------------------------');
  console.log(`Instytucja: ${inst.name} (${inst.locality || '?'})`);
  console.log(`Strona:     ${obfuscation.url}`);
  console.log(`Fragment:   ${obfuscation.snippet.slice(0, 240)}`);
  const answer = (await getReadline().question(`Podaj ${field === 'email' ? 'e-mail' : 'telefon'} (Enter = pomiń): `)).trim();
  if (!answer) {
    stats.prompts_skipped += 1;
    return;
  }
  if (field === 'email' && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(answer)) {
    stats.prompts_answered += 1;
    applyEmail(inst, answer, 'wpis ręczny (antyspam)');
  } else if (field === 'phone' && answer.replace(/\D/g, '').length >= 9) {
    stats.prompts_answered += 1;
    applyPhone(inst, answer, 'wpis ręczny (antyspam)');
  } else {
    stats.prompts_skipped += 1;
    console.log('  Wartość nie wygląda poprawnie - pominięto.');
  }
}

async function fillContactsFromSite(inst, pageUrl, html, how) {
  const needPhone = !inst.phone;
  const needEmail = !inst.email;
  if (!needPhone && !needEmail) return;
  if (needPhone) stats.phone_tried += 1;
  if (needEmail) stats.email_tried += 1;

  const pages = await collectContactPages(pageUrl, html);
  let host = '';
  try {
    host = new URL(pageUrl).hostname;
  } catch {
    /* bez preferencji domeny */
  }
  const found = harvestContacts(pages, host);
  stats.email_deobfuscated += found.deobfuscated;

  if (needEmail) {
    if (found.email) applyEmail(inst, found.email, how);
    else if (found.obfuscation) await promptManual(inst, 'email', found.obfuscation);
  }
  if (needPhone && found.phone) applyPhone(inst, found.phone.raw, how);
}

// --- Faza 4: wyszukiwarka ----------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let consecutiveSearchFailures = 0;
let searchDisabled = false;

// Blokada bywa też stroną 200 z captchą - bez tej detekcji wyglądałaby
// jak "brak wyników" i wpis dostałby błędnie odnotowaną próbę.
const DDG_BLOCK_RE = /anomaly|captcha|unusual traffic|too many requests|bots use DuckDuckGo too/i;

async function ddgSearch(query) {
  if (searchDisabled) return null;
  stats.search_queries += 1;
  await sleep(1800 + Math.random() * 900);
  const res = await fetchPage(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  if (res.ok && res.html && DDG_BLOCK_RE.test(res.html) && !/class="result__a"/.test(res.html)) {
    res.ok = false;
  }
  if (!res.ok || !res.html) {
    stats.search_blocked += 1;
    consecutiveSearchFailures += 1;
    if (consecutiveSearchFailures >= 5) {
      searchDisabled = true;
      console.log('  [!] Wyszukiwarka blokuje zapytania - przerywam fazę wyszukiwania.');
    } else {
      await sleep(15000);
    }
    return null;
  }
  consecutiveSearchFailures = 0;
  return parseDdgResults(res.html);
}

const SOCIAL_ONLY_BLOCKLIST = /facebook|instagram|youtube|twitter|x\.com|tiktok|wikipedia|google|duckduckgo/i;

// Zwraca true, jeśli wyszukiwarka odpowiedziała na co najmniej jedno
// zapytanie - tylko wtedy wolno odnotować próbę w dzienniku (zablokowane
// zapytania to nie jest przeszukanie wpisu).
async function searchForInstitution(inst) {
  let searched = false;
  const needWww = !inst.__working;
  const queries = [];
  const nameLoc = `${inst.name} ${inst.locality || ''}`.trim();
  if (needWww) {
    queries.push(nameLoc);
    const address = [inst.street, inst.building_no, inst.postal_code, inst.post_office || inst.locality]
      .filter(Boolean)
      .join(' ');
    if (address) queries.push(`${inst.name} ${address}`);
  } else {
    queries.push(`${nameLoc} kontakt telefon e-mail`);
  }

  if (needWww) stats.www_from_search_tried += 1;

  for (const query of queries) {
    const urls = await ddgSearch(query);
    if (urls === null) {
      if (searchDisabled) return searched;
      continue;
    }
    searched = true;
    if (needWww) {
      for (const candidate of pickSearchCandidates(urls, 4)) {
        const page = await tryUrl(candidate);
        if (!page.ok || !page.html) continue;
        if (!strongMatchesInstitution(page.html, inst)) continue;
        // ten sam host -> origin (strona główna serwisu); przekierowanie na
        // inny host -> pełny adres docelowy z podstroną
        let value;
        try {
          value = isCrossHostRedirect(candidate, page.finalUrl)
            ? canonicalWebsiteValue(candidate, page.finalUrl)
            : new URL(page.finalUrl).origin;
        } catch {
          continue;
        }
        stats.www_from_search_filled += 1;
        applyWebsite(inst, value, 'wyszukiwarka (nazwa/adres)');
        inst.__working = { url: page.finalUrl, html: page.html };
        await fillContactsFromSite(inst, page.finalUrl, page.html, 'strona znaleziona wyszukiwarką');
        return searched;
      }
    } else {
      // strona jest, ale kontaktów na niej nie było - szukamy na innych
      // stronach (katalogi, BIP-y), z ostrym dopasowaniem treści
      const candidates = urls.filter((u) => !SOCIAL_ONLY_BLOCKLIST.test(u)).slice(0, 3);
      for (const candidate of candidates) {
        const page = await tryUrl(candidate);
        if (!page.ok || !page.html) continue;
        if (!htmlMatchesInstitution(page.html, inst, { strict: true })) continue;
        const found = harvestContacts([{ url: page.finalUrl, html: page.html }], '');
        stats.email_deobfuscated += found.deobfuscated;
        if (!inst.email && found.email) {
          stats.email_tried += 1;
          applyEmail(inst, found.email, `wyszukiwarka: ${new URL(page.finalUrl).hostname}`);
        }
        if (!inst.phone && found.phone) {
          stats.phone_tried += 1;
          applyPhone(inst, found.phone.raw, `wyszukiwarka: ${new URL(page.finalUrl).hostname}`);
        }
        if (inst.email && inst.phone) return searched;
      }
      return searched; // jedno zapytanie wystarczy w tym trybie
    }
  }
  return searched;
}

// --- Pula współbieżności ------------------------------------------------------------

async function pool(items, size, worker) {
  let next = 0;
  let done = 0;
  const total = items.length;
  await Promise.all(
    Array.from({ length: Math.min(size, total) }, async () => {
      while (next < total) {
        const idx = next++;
        await worker(items[idx]);
        done += 1;
        if (done % 50 === 0) console.log(`  ... ${done}/${total}`);
      }
    })
  );
}

// --- Główny przebieg -----------------------------------------------------------------

const hasValue = (v) => v !== null && v !== undefined && String(v).trim() !== '';

async function main() {
  const institutions = db.prepare('SELECT * FROM institutions ORDER BY id').all();
  console.log(`Instytucji w bazie: ${institutions.length}${DRY_RUN ? '  [TRYB PRÓBNY - bez zapisu]' : ''}`);

  // Faza 1 (w trybie --only-search pomijana; istniejące strony traktujemy
  // jako działające, żeby faza 4 nie szukała im zamienników)
  if (ONLY_SEARCH) {
    console.log('\n== Tryb --only-search: pomijam fazy 1-3 ==');
    for (const inst of institutions) {
      if (hasValue(inst.website)) inst.__working = { url: inst.website, html: '' };
    }
  }
  const withWww = ONLY_SEARCH ? [] : institutions.filter((i) => hasValue(i.website)).slice(0, LIMIT);
  if (!ONLY_SEARCH) console.log(`\n== Faza 1: weryfikacja ${withWww.length} adresów WWW ==`);
  const wwwSuggestions = [];
  await pool(withWww, CONCURRENCY, async (inst) => {
    stats.www_checked += 1;
    const r = await resolveWebsite(inst);
    if (r.status === 'ok') stats.www_ok += 1;
    else if (r.status === 'fixed') {
      stats.www_fixed += 1;
      applyWebsite(inst, r.newValue, 'obcięcie podstrony/subdomeny');
    } else {
      stats.www_dead += 1;
      report.dead_websites.push({ regon: inst.regon, name: inst.name, website: inst.website, last_status: r.lastStatus });
      if (r.suggestion) wwwSuggestions.push({ inst, suggestion: r.suggestion });
    }
    if (r.status !== 'dead') {
      const needsContacts = !hasValue(inst.phone) || !hasValue(inst.email);
      inst.__working = { url: r.pageUrl, html: needsContacts ? r.html : '' };
    }
  });

  // Sugestie dla martwych stron: kandydat powiązany z instytucją, ale bez
  // twardego identyfikatora (typowo strona gminy/miasta) - decyzja należy
  // do użytkownika. Sekwencyjnie, bo w terminalu pytamy interaktywnie.
  for (const { inst, suggestion } of wwwSuggestions) {
    if (DRY_RUN || !process.stdin.isTTY) {
      stats.review_queued += 1;
      report.review.push({ regon: inst.regon, name: inst.name, locality: inst.locality, field: 'website', url: suggestion, snippet: `martwa: ${inst.website}` });
      console.log(`  [?] ${inst.name}: martwa strona ${inst.website}; powiązana kandydatka ${suggestion} - w kolejce przeglądu`);
      continue;
    }
    stats.prompts_shown += 1;
    console.log('\n--- MARTWA STRONA - SUGESTIA ZAMIENNIKA -----------------------');
    console.log(`Instytucja: ${inst.name} (${inst.locality || '?'})`);
    console.log(`Martwa:     ${inst.website}`);
    console.log(`Kandydatka: ${suggestion} (powiązana treścią, ale bez twardego identyfikatora)`);
    const answer = (await getReadline().question('Zapisać kandydatkę? [t/N]: ')).trim().toLowerCase();
    if (answer === 't' || answer === 'tak') {
      stats.prompts_answered += 1;
      applyWebsite(inst, suggestion, 'sugestia zaakceptowana ręcznie');
      inst.__working = { url: inst.website, html: '' };
    } else {
      stats.prompts_skipped += 1;
    }
  }

  // Faza 2
  const fromEmail = ONLY_SEARCH
    ? []
    : institutions
        .filter((i) => !hasValue(i.website) && hasValue(i.email) && !isGenericEmailDomain(emailDomain(i.email)))
        .slice(0, LIMIT);
  if (!ONLY_SEARCH) console.log(`\n== Faza 2: próba wyprowadzenia WWW z domeny e-mail (${fromEmail.length} wpisów) ==`);
  await pool(fromEmail, CONCURRENCY, async (inst) => {
    stats.www_from_email_tried += 1;
    const domain = emailDomain(inst.email);
    for (const candidate of [`https://${domain}`, `https://www.${domain}`]) {
      const page = await tryUrl(candidate);
      if (!page.ok || !page.html) continue;
      if (looksLikeParkedPage(page.html)) continue;
      if (!htmlMatchesInstitution(page.html, inst)) continue;
      stats.www_from_email_filled += 1;
      applyWebsite(inst, candidate, 'domena z adresu e-mail');
      inst.__working = { url: page.finalUrl, html: page.html };
      break;
    }
  });

  // Faza 3 (sekwencyjnie - mogą pojawić się prompty)
  const needContacts = ONLY_SEARCH
    ? []
    : institutions
        .filter((i) => i.__working && (!hasValue(i.phone) || !hasValue(i.email)))
        .slice(0, LIMIT);
  if (!ONLY_SEARCH) console.log(`\n== Faza 3: uzupełnianie telefonów/e-maili ze stron (${needContacts.length} wpisów) ==`);
  for (const inst of needContacts) {
    let { url, html } = inst.__working;
    if (!html) {
      const page = await tryUrl(url);
      if (!page.ok || !page.html) continue;
      url = page.finalUrl;
      html = page.html;
    }
    await fillContactsFromSite(inst, url, html, 'strona instytucji');
  }

  // Faza 4
  if (!NO_SEARCH) {
    const incomplete = institutions.filter(
      (i) => !i.__working || !hasValue(i.phone) || !hasValue(i.email)
    );
    // dziennik prób: pomijamy wpisy próbowane w okresie cooldownu, a te
    // nigdy nie próbowane idą pierwsze - przerwany przebieg kontynuuje
    // od miejsca, do którego doszedł, zamiast mielić od zera tę samą listę
    const attempts = allAttempts();
    const cooldownMs = SEARCH_COOLDOWN_DAYS * 24 * 3600 * 1000;
    const isFresh = (i) => {
      const a = attempts.get(i.regon);
      return !a || RETRY_SEARCH || Date.now() - Date.parse(a.attempted_at) > cooldownMs;
    };
    const pending = incomplete
      .filter(isFresh)
      .sort((a, b) => (attempts.has(a.regon) ? 1 : 0) - (attempts.has(b.regon) ? 1 : 0))
      .slice(0, Math.min(LIMIT, SEARCH_LIMIT));
    stats.search_skipped_recent = incomplete.length - incomplete.filter(isFresh).length;
    console.log(
      `\n== Faza 4: wyszukiwarka - niekompletnych ${incomplete.length}, po niedawnej próbie pominięto ${stats.search_skipped_recent}, do przetworzenia ${pending.length} ==`
    );
    let processed = 0;
    for (const inst of pending) {
      if (searchDisabled) {
        stats.search_skipped_after_block = pending.length - processed;
        break;
      }
      const searched = await searchForInstitution(inst);
      if (searchDisabled) {
        // blokada mogła przerwać w połowie tego wpisu - nie zaliczamy próby
        stats.search_skipped_after_block = pending.length - processed;
        break;
      }
      processed += 1;
      const complete = inst.__working && hasValue(inst.phone) && hasValue(inst.email);
      if (!DRY_RUN && searched) {
        upsertAttempt.run({
          regon: inst.regon,
          attempted_at: new Date().toISOString(),
          outcome: complete ? 'filled' : 'not_found',
        });
      }
      if (processed % 25 === 0) console.log(`  ... ${processed}/${pending.length}`);
    }
  }

  // Raport i statystyki
  report.finished_at = new Date().toISOString();
  report.stats = stats;
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  if (report.review.length > 0) fs.writeFileSync(REVIEW_PATH, JSON.stringify(report.review, null, 2));

  console.log('\n================= STATYSTYKI =================');
  console.log(`WWW - weryfikacja:        sprawdzono ${stats.www_checked}, działa ${stats.www_ok}, naprawiono ${stats.www_fixed}, martwe ${stats.www_dead}`);
  console.log(`WWW - z domeny e-mail:    prób ${stats.www_from_email_tried}, uzupełniono ${stats.www_from_email_filled}`);
  console.log(`WWW - z wyszukiwarki:     prób ${stats.www_from_search_tried}, uzupełniono ${stats.www_from_search_filled}`);
  console.log(`Telefon:                  prób ${stats.phone_tried}, uzupełniono ${stats.phone_filled}`);
  console.log(`E-mail:                   prób ${stats.email_tried}, uzupełniono ${stats.email_filled} (w tym odszyfrowane z antyspamu: ${stats.email_deobfuscated})`);
  console.log(`Prompty (antyspam):       ${stats.prompts_shown} (wpisano ${stats.prompts_answered}, pominięto ${stats.prompts_skipped}); w kolejce przeglądu: ${stats.review_queued}`);
  console.log(`Zapytania wyszukiwarki:   ${stats.search_queries} (odrzucone ${stats.search_blocked}${stats.search_skipped_after_block ? `, pominięte po blokadzie: ${stats.search_skipped_after_block}` : ''}${stats.search_skipped_recent ? `, po niedawnej próbie: ${stats.search_skipped_recent}` : ''})`);
  console.log(`Odwiedzone podstrony kontaktowe: ${stats.contact_pages_visited}`);
  console.log(`Raport: ${path.relative(process.cwd(), REPORT_PATH)}${report.review.length ? `, kolejka przeglądu: ${path.relative(process.cwd(), REVIEW_PATH)}` : ''}`);
  if (DRY_RUN) console.log('Tryb próbny: żadne zmiany NIE zostały zapisane do bazy.');

  if (rl) rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
