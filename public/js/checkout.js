// Modal płatności: Stripe Embedded Checkout osadzony w oknie Bootstrapa.
// Cenę i liczbę rekordów pokazujemy z odpowiedzi serwera (nie liczymy jej tutaj) -
// przeglądarka nigdy nie decyduje o kwocie.
//
// Po zakończeniu płatności NIE przekierowujemy na osobną stronę: sesja Stripe ma
// redirect_on_completion:'never', więc Stripe.js woła onComplete, a status i link
// do pobrania renderujemy w tym samym modalu.
(() => {
  const config = window.BDIK_STRIPE || {};
  const POLL_INTERVAL_MS = 2000;
  const POLL_TIMEOUT_MS = 3 * 60 * 1000;

  let stripe = null;
  let embedded = null;
  let modal = null;
  let currentToken = null;

  function el(id) {
    return document.getElementById(id);
  }

  function showError(message) {
    const box = el('checkout-error');
    box.textContent = message;
    box.classList.remove('d-none');
    el('checkout-loading').classList.add('d-none');
  }

  function resetModal() {
    currentToken = null;
    el('checkout-error').classList.add('d-none');
    el('checkout-pay').classList.remove('d-none');
    el('checkout-result').classList.add('d-none');
    el('result-pending').classList.add('d-none');
    el('result-paid').classList.add('d-none');
    el('result-failed').classList.add('d-none');
    el('checkout-loading').classList.remove('d-none');
    el('checkout-container').innerHTML = '';
    el('checkout-summary-title').textContent = 'Przygotowywanie…';
    el('checkout-summary-filters').textContent = '';
    ['sum-rows', 'sum-perrow', 'sum-net', 'sum-vat', 'sum-gross'].forEach((id) => {
      el(id).textContent = '—';
    });
  }

  function renderSummary(data) {
    el('checkout-summary-title').textContent = `${data.formatLabel} · ${data.rowCount} instytucji`;
    el('checkout-summary-filters').textContent = data.description;
    const p = data.pricing || {};
    el('sum-rows').textContent = data.rowCount;
    el('sum-perrow').textContent = p.perRowLabel || '—';
    el('sum-net').textContent = p.netLabel || '—';
    if (p.vatRate) el('sum-vat-label').textContent = `VAT (${p.vatRate}%)`;
    el('sum-vat').textContent = p.vatLabel || '—';
    el('sum-gross').textContent = p.grossLabel || data.amountLabel || '—';
  }

  // Przejście z widoku płatności do widoku wyniku - kwota/opis w nagłówku
  // zostają jako paragon.
  function showResultView(state) {
    el('checkout-pay').classList.add('d-none');
    el('checkout-result').classList.remove('d-none');
    ['pending', 'paid', 'failed'].forEach((name) => {
      el(`result-${name}`).classList.toggle('d-none', name !== state);
    });
  }

  function renderPaid(data) {
    el('result-payment-intent').textContent = data.paymentIntent || 'w trakcie księgowania';
    if (data.downloadUrl) el('result-download-btn').setAttribute('href', data.downloadUrl);
    if (data.downloadUrlAbsolute) el('result-link').value = data.downloadUrlAbsolute;
    showResultView('paid');
  }

  async function pollStatus(startedAt) {
    if (!currentToken) return;
    try {
      const res = await fetch(`/api/checkout/${currentToken}`);
      if (!res.ok) throw new Error('status');
      const data = await res.json();

      if (data.status === 'paid') return renderPaid(data);
      if (data.status === 'failed' || data.status === 'expired') return showResultView('failed');
    } catch (_) {
      /* przejściowy błąd sieci - próbujemy dalej */
    }

    if (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      setTimeout(() => pollStatus(startedAt), POLL_INTERVAL_MS);
    } else {
      showResultView('failed');
    }
  }

  // Stripe woła to, gdy klient domknie płatność. Dla BLIK/P24 status bywa jeszcze
  // "pending" (bank potwierdza z opóźnieniem) - pokazujemy spinner i odpytujemy
  // serwer, aż zamówienie stanie się "paid".
  function onCheckoutComplete() {
    showResultView('pending');
    pollStatus(Date.now());
  }

  async function copyLink() {
    const input = el('result-link');
    const btn = el('result-copy-btn');
    try {
      await navigator.clipboard.writeText(input.value);
    } catch (_) {
      input.select();
      document.execCommand('copy');
    }
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="bi bi-check2 me-1"></i>Skopiowano';
    setTimeout(() => { btn.innerHTML = original; }, 1500);
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Nie udało się rozpocząć płatności.');
    return data;
  }

  // Poprzednia instancja Embedded Checkout musi zostać zniszczona, zanim
  // zamontujemy kolejną - inaczej Stripe.js rzuci błędem przy drugim otwarciu.
  async function destroyEmbedded() {
    if (!embedded) return;
    try {
      embedded.destroy();
    } catch (_) {
      /* instancja mogła już zostać rozmontowana */
    }
    embedded = null;
  }

  async function openCheckout(selection) {
    if (!config.configured || !window.Stripe) {
      window.alert('Płatności nie są w tej chwili dostępne. Spróbuj ponownie później.');
      return;
    }

    if (!modal) {
      const node = el('payment-modal');
      modal = new bootstrap.Modal(node);
      node.addEventListener('hidden.bs.modal', destroyEmbedded);
      el('result-copy-btn').addEventListener('click', copyLink);
    }
    if (!stripe) stripe = window.Stripe(config.publishableKey);

    await destroyEmbedded();
    resetModal();
    modal.show();

    try {
      // Najpierw sama wycena - kwota pojawia się w modalu od razu, zanim
      // Stripe zdąży wyrenderować formularz.
      const quote = await postJson('/api/checkout/quote', selection);
      if (quote.rowCount === 0) {
        showError('Wybrane filtry nie zwracają żadnych instytucji - nie ma czego eksportować.');
        return;
      }
      renderSummary(quote);

      const session = await postJson('/api/checkout', selection);
      renderSummary(session);
      currentToken = session.token;

      embedded = await stripe.createEmbeddedCheckoutPage({
        clientSecret: session.clientSecret,
        onComplete: onCheckoutComplete,
      });
      el('checkout-loading').classList.add('d-none');
      embedded.mount('#checkout-container');
    } catch (err) {
      showError(err.message);
    }
  }

  window.openCheckout = openCheckout;
})();
