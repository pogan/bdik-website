// Modal płatności: Stripe Embedded Checkout osadzony w oknie Bootstrapa.
// Cenę i liczbę rekordów pokazujemy z odpowiedzi serwera (nie liczymy jej tutaj) -
// przeglądarka nigdy nie decyduje o kwocie.
(() => {
  const config = window.BDIK_STRIPE || {};
  let stripe = null;
  let embedded = null;
  let modal = null;

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
    el('checkout-error').classList.add('d-none');
    el('checkout-loading').classList.remove('d-none');
    el('checkout-container').innerHTML = '';
    el('checkout-summary-title').textContent = 'Przygotowywanie…';
    el('checkout-summary-filters').textContent = '';
    el('checkout-summary-price').textContent = '—';
  }

  function renderSummary(data) {
    el('checkout-summary-title').textContent = `${data.formatLabel} · ${data.rowCount} instytucji`;
    el('checkout-summary-filters').textContent = data.description;
    el('checkout-summary-price').textContent = data.amountLabel;
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

      embedded = await stripe.initEmbeddedCheckout({ clientSecret: session.clientSecret });
      el('checkout-loading').classList.add('d-none');
      embedded.mount('#checkout-container');
    } catch (err) {
      showError(err.message);
    }
  }

  window.openCheckout = openCheckout;
})();
