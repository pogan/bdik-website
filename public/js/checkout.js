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
  // Zakres wyboru z chwili otwarcia modala - potrzebny w kroku "Przejdź do
  // płatności", który zakłada zamówienie dopiero po zaznaczeniu zgód.
  let pendingSelection = null;
  let listenersBound = false;

  function el(id) {
    return document.getElementById(id);
  }

  // Statystyki lejka (patrz public/js/table.js - ta sama konwencja sendBeacon).
  function track(name) {
    if (navigator.sendBeacon) navigator.sendBeacon(`/api/events/${name}`);
    else fetch(`/api/events/${name}`, { method: 'POST', keepalive: true });
  }

  // Przycisk "Przejdź do płatności" aktywny tylko, gdy oba oświadczenia zaznaczone.
  function refreshConsentButton() {
    const ok = el('consent-terms').checked && el('consent-withdrawal').checked;
    el('consent-continue').disabled = !ok;
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
    // Start od ekranu zgód; formularz płatności pokazujemy dopiero po ich zaznaczeniu.
    el('checkout-consents').classList.remove('d-none');
    el('consent-terms').checked = false;
    el('consent-withdrawal').checked = false;
    el('consent-continue').disabled = true;
    el('checkout-pay').classList.add('d-none');
    el('checkout-result').classList.add('d-none');
    el('result-pending').classList.add('d-none');
    el('result-paid').classList.add('d-none');
    el('result-failed').classList.add('d-none');
    el('checkout-loading').classList.remove('d-none');
    el('checkout-container').innerHTML = '';
    el('checkout-summary-title').textContent = 'Przygotowywanie…';
    el('checkout-summary-filters').textContent = '';
    el('checkout-coverage').classList.add('d-none');
    ['sum-rows', 'sum-perrow', 'sum-net', 'sum-vat', 'sum-gross'].forEach((id) => {
      el(id).textContent = '—';
    });
  }

  // Pokrycie danych kontaktowych w wybranym zakresie: dla każdego kanału pokazujemy
  // "wypełnione/wszystkie" i procent, z kolorem jak przy badge'ach w tabeli.
  const COVERAGE_FIELDS = [
    { key: 'phone', label: 'Telefon' },
    { key: 'email', label: 'E-mail' },
    { key: 'website', label: 'WWW' },
  ];

  function renderCoverage(coverage) {
    const box = el('checkout-coverage');
    if (!coverage || !coverage.total || !coverage.fields) {
      box.classList.add('d-none');
      return;
    }
    let any = false;
    COVERAGE_FIELDS.forEach((f) => {
      const span = el(`cov-${f.key}`);
      const stats = coverage.fields[f.key];
      if (!stats) {
        span.classList.add('d-none');
        return;
      }
      const pct = Math.round((stats.filled / coverage.total) * 100);
      const tone = pct >= 70 ? 'success' : pct >= 30 ? 'warning' : 'danger';
      span.className = `badge rounded-pill bg-${tone}-subtle text-${tone}-emphasis`;
      span.textContent = `${f.label}: ${stats.filled}/${coverage.total} (${pct}%)`;
      any = true;
    });
    box.classList.toggle('d-none', !any);
  }

  function renderSummary(data) {
    el('checkout-summary-title').textContent = `${data.formatLabel} · ${data.rowCount} instytucji`;
    el('checkout-summary-filters').textContent = data.description;
    renderCoverage(data.coverage);
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
    if (!listenersBound) {
      el('consent-terms').addEventListener('change', refreshConsentButton);
      el('consent-withdrawal').addEventListener('change', refreshConsentButton);
      el('consent-continue').addEventListener('click', proceedToPayment);
      listenersBound = true;
    }
    if (!stripe) stripe = window.Stripe(config.publishableKey);

    await destroyEmbedded();
    resetModal();
    pendingSelection = selection;
    modal.show();

    try {
      // Sama wycena - kwota pojawia się w modalu od razu. Zamówienia jeszcze NIE
      // zakładamy: powstanie dopiero po zaznaczeniu zgód i kliknięciu "Przejdź do
      // płatności" (proceedToPayment), więc samo obejrzenie ceny nie tworzy rekordu.
      const quote = await postJson('/api/checkout/quote', selection);
      if (quote.rowCount === 0) {
        showError('Wybrane filtry nie zwracają żadnych instytucji - nie ma czego eksportować.');
        return;
      }
      renderSummary(quote);
    } catch (err) {
      showError(err.message);
    }
  }

  // Krok po zaznaczeniu obu zgód: zakłada zamówienie (z flagami zgód, które
  // serwer i tak waliduje) i montuje formularz Stripe.
  async function proceedToPayment() {
    if (!pendingSelection) return;
    track('consents_ok');
    el('checkout-error').classList.add('d-none');
    el('checkout-consents').classList.add('d-none');
    el('checkout-pay').classList.remove('d-none');
    el('checkout-loading').classList.remove('d-none');

    try {
      const session = await postJson('/api/checkout', {
        ...pendingSelection,
        termsAccepted: true,
        withdrawalConsent: true,
      });
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
