// Pasek cookies: pokazujemy tylko, dopóki użytkownik nie kliknął "Rozumiem".
// Stan trzymamy w localStorage - żadnych własnych ciasteczek ani skryptów obcych.
(() => {
  const KEY = 'bdik-cookies-ack';
  const banner = document.getElementById('cookie-banner');
  if (!banner) return;

  let acked = false;
  try {
    acked = localStorage.getItem(KEY) === '1';
  } catch (_) {
    // Prywatny tryb przeglądarki potrafi blokować localStorage - wtedy pokazujemy
    // pasek za każdym razem (informacja i tak jest niezbędna, nie zgoda).
  }

  if (!acked) banner.classList.remove('d-none');

  const btn = document.getElementById('cookie-accept');
  if (btn) {
    btn.addEventListener('click', () => {
      banner.classList.add('d-none');
      try {
        localStorage.setItem(KEY, '1');
      } catch (_) {
        /* brak localStorage - trudno, po prostu nie zapamiętamy */
      }
    });
  }
})();
