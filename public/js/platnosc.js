// Strona powrotu ze Stripe. BLIK bywa potwierdzany z opóźnieniem (klient
// akceptuje w aplikacji banku), a webhook może dotrzeć chwilę po przekierowaniu -
// dlatego odpytujemy o status, dopóki zamówienie jest w stanie "pending".
(() => {
  const card = document.getElementById('order-card');
  if (!card) return;

  const token = card.dataset.token;
  const POLL_INTERVAL_MS = 2000;
  const POLL_TIMEOUT_MS = 3 * 60 * 1000;
  const startedAt = Date.now();
  let autoDownloaded = false;

  function show(state) {
    ['paid', 'pending', 'failed'].forEach((name) => {
      document.getElementById(`state-${name}`).classList.toggle('d-none', name !== state);
    });
  }

  function applyPaid(data) {
    const btn = document.getElementById('download-btn');
    if (data.downloadUrl) btn.href = data.downloadUrl;
    show('paid');
    if (!autoDownloaded && data.downloadUrl) {
      autoDownloaded = true;
      window.location.assign(data.downloadUrl);
    }
  }

  async function poll() {
    try {
      const res = await fetch(`/api/checkout/${token}`);
      if (!res.ok) throw new Error('status');
      const data = await res.json();

      if (data.status === 'paid') return applyPaid(data);
      if (data.status === 'failed' || data.status === 'expired') return show('failed');
    } catch (_) {
      /* przejściowy błąd sieci - próbujemy dalej */
    }

    if (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      return setTimeout(poll, POLL_INTERVAL_MS);
    }
    return show('failed');
  }

  if (card.dataset.status === 'paid') {
    // Płatność już potwierdzona po stronie serwera - zaczynamy pobieranie.
    const btn = document.getElementById('download-btn');
    if (btn && btn.getAttribute('href') && btn.getAttribute('href') !== '#') {
      autoDownloaded = true;
      window.location.assign(btn.getAttribute('href'));
    }
  } else if (card.dataset.status === 'pending') {
    setTimeout(poll, POLL_INTERVAL_MS);
  }
})();
