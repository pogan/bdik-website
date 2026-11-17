// Formularz "próbka na e-mail" (lead), wspólny dla /baza i poradników.
// Zgoda wymagana po stronie serwera, ale sprawdzamy ją też tutaj, żeby
// komunikat był natychmiastowy.
(function () {
  function attachLeadHandler() {
    const form = document.getElementById('lead-form');
    if (!form) return;
    const status = document.getElementById('lead-status');
    const show = (msg, ok) => {
      status.textContent = msg;
      status.className = `small mt-1 ${ok ? 'text-success' : 'text-danger'}`;
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('lead-email').value.trim();
      if (!email) {
        show('Podaj adres e-mail.', false);
        return;
      }
      if (!document.getElementById('lead-consent').checked) {
        show('Zaznacz zgodę, żebyśmy mogli wysłać Ci próbkę.', false);
        return;
      }
      try {
        const res = await fetch('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, consent: true }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Nie udało się zapisać adresu. Spróbuj ponownie.');
        }
        show('Dziękujemy! Próbka jest w drodze na Twój e-mail.', true);
        document.getElementById('lead-submit').disabled = true;
      } catch (err) {
        show(err.message, false);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', attachLeadHandler);
})();
