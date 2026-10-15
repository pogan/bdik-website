// Pasek cookies. Bez GA4 (brak data-ga-id) to tylko informacja: chowamy go po
// "Rozumiem". Z GA4 pytamy o zgodę i ładujemy gtag.js wyłącznie po "Akceptuję" -
// przed zgodą do Google nie idzie żadne żądanie. Wybór trzymamy w localStorage;
// link [data-cookie-settings] (stopka) pokazuje pasek ponownie, żeby można
// było zgodę wycofać.
(() => {
  const ACK_KEY = 'bdik-cookies-ack';
  const CONSENT_KEY = 'bdik-analytics-consent';
  const banner = document.getElementById('cookie-banner');
  if (!banner) return;

  const gaId = banner.dataset.gaId;

  const read = (key) => {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      // Prywatny tryb przeglądarki potrafi blokować localStorage - wtedy
      // pokazujemy pasek za każdym razem.
      return null;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch (_) {
      /* brak localStorage - trudno, po prostu nie zapamiętamy */
    }
  };

  let gaLoaded = false;
  const loadAnalytics = () => {
    if (gaLoaded || !gaId) return;
    gaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', gaId);
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
    document.head.appendChild(s);
  };

  // Usuwa ciasteczka _ga* po wycofaniu zgody (GA ustawia je na domenie nadrzędnej).
  const clearAnalyticsCookies = () => {
    const host = location.hostname.replace(/^www\./, '');
    document.cookie.split(';').forEach((c) => {
      const name = c.split('=')[0].trim();
      if (!name.startsWith('_ga')) return;
      [host, `.${host}`, ''].forEach((domain) => {
        document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`;
      });
    });
  };

  const hide = () => banner.classList.add('d-none');
  const show = () => banner.classList.remove('d-none');

  if (gaId) {
    const consent = read(CONSENT_KEY);
    if (consent === 'granted') loadAnalytics();
    else if (consent !== 'denied') show();

    document.getElementById('cookie-accept')?.addEventListener('click', () => {
      write(CONSENT_KEY, 'granted');
      hide();
      loadAnalytics();
    });
    document.getElementById('cookie-reject')?.addEventListener('click', () => {
      const wasGranted = read(CONSENT_KEY) === 'granted';
      write(CONSENT_KEY, 'denied');
      hide();
      clearAnalyticsCookies();
      // Załadowany już gtag.js nie da się "wyładować" - przeładowanie strony.
      if (wasGranted && gaLoaded) location.reload();
    });
  } else {
    if (read(ACK_KEY) !== '1') show();
    document.getElementById('cookie-accept')?.addEventListener('click', () => {
      hide();
      write(ACK_KEY, '1');
    });
  }

  document.querySelectorAll('[data-cookie-settings]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      show();
    });
  });
})();
