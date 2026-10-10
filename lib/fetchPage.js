// Pobieranie stron HTML z poprawną obsługą kodowania (stare strony
// instytucji bywają w iso-8859-2/windows-1250) i fallbackiem https -> http.
// Używane przez scripts/enrich_contacts.js i skrypty naprawcze.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
// Część serwerów (mod_security/WAF hostingów) odrzuca "Chrome" bez nagłówków
// sec-ch-ua przeglądarki: 403 (gckib.iwanowice.pl) albo 429 (gok.miedzna.pl).
// Przy takiej odmowie ponawiamy z innym UA.
const FALLBACK_UAS = ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0'];

// Statusy "serwer istnieje, ale nas nie wpuszcza" - to nie jest martwa strona.
const BLOCKED_STATUSES = new Set([401, 403, 406, 429, 503]);
const isBlockedStatus = (status) => BLOCKED_STATUSES.has(status);

function detectCharset(contentType, buf) {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType || '');
  if (fromHeader) return fromHeader[1];
  const head = buf.subarray(0, 2048).toString('latin1');
  const fromMeta =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) ||
    /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head);
  return fromMeta ? fromMeta[1] : 'utf-8';
}

function decodeBody(buf, contentType) {
  const charset = detectCharset(contentType, buf);
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return buf.toString('utf-8');
  }
}

const MAX_REDIRECTS = 10;

async function fetchPage(url, { timeoutMs = 10000, userAgent = UA } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Przekierowania prowadzimy sami, z pamięcią ciasteczek: część CMS-ów
    // (gok.dabrowazielona.pl) przekierowuje na samą siebie, dopóki klient nie
    // odeśle ciasteczka sesji - fetch bez ciasteczek kończy to pętlą
    // "redirect count exceeded" i działająca strona wygląda na martwą.
    const cookies = new Map();
    let current = url;
    let res;
    for (let hop = 0; ; hop++) {
      res = await fetch(current, {
        signal: ctrl.signal,
        redirect: 'manual',
        headers: {
          'user-agent': userAgent,
          accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          'accept-language': 'pl,en;q=0.7',
          ...(cookies.size ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        },
      });
      for (const c of res.headers.getSetCookie()) {
        const m = /^([^=;\s]+)=([^;]*)/.exec(c);
        if (m) cookies.set(m[1], m[2]);
      }
      const location = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !location) break;
      if (hop >= MAX_REDIRECTS) throw Object.assign(new Error('too many redirects'), { cause: { code: 'TOO_MANY_REDIRECTS' } });
      await res.body?.cancel();
      current = new URL(location, current).href;
    }
    const contentType = res.headers.get('content-type') || '';
    let html = '';
    if (res.ok && (contentType === '' || /text\/html|application\/xhtml/i.test(contentType))) {
      const buf = Buffer.from(await res.arrayBuffer());
      html = decodeBody(buf.subarray(0, 1_000_000), contentType);
    }
    return { ok: res.ok, status: res.status, finalUrl: current, html };
  } catch (err) {
    return { ok: false, status: 0, error: err?.cause?.code || err?.name || 'error', finalUrl: url, html: '' };
  } finally {
    clearTimeout(timer);
  }
}

// https z fallbackiem na http (stare serwery bez TLS); ponowienie z innym
// UA przy odmowie WAF; opcjonalne jedno ponowienie przy błędzie sieciowym
// (timeouty bywają przejściowe).
async function tryUrl(url, { timeoutMs = 10000, retryOnce = false } = {}) {
  let page = await fetchPage(url, { timeoutMs });
  if (!page.ok && page.status === 0 && url.startsWith('https://')) {
    page = await fetchPage(url.replace(/^https:/, 'http:'), { timeoutMs });
  }
  // blocked: serwer odpowiedział odmową (choćby przy jednym UA) albo błędem
  // 5xx - host istnieje, więc nie wolno go "naprawiać" obcięciem subdomeny
  const blocked = isBlockedStatus(page.status) || page.status >= 500;
  for (const userAgent of FALLBACK_UAS) {
    if (!isBlockedStatus(page.status)) break;
    page = await fetchPage(page.finalUrl || url, { timeoutMs, userAgent });
  }
  if (blocked && !page.ok) page.blocked = true;
  if (!page.ok && page.status === 0 && retryOnce) {
    await new Promise((r) => setTimeout(r, 1500));
    return tryUrl(url, { timeoutMs, retryOnce: false });
  }
  return page;
}

module.exports = { fetchPage, tryUrl, decodeBody, detectCharset, UA };
