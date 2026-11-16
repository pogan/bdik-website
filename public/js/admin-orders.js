// Filtr statusu w panelu zamówień (views/admin-orders.ejs). Serwer wysyła
// wszystkie wiersze; tu tylko je chowamy i pokazujemy, bez przeładowania.
// Adres dostaje ?status=..., żeby zakładka i odświeżenie dawały ten sam widok.
// Bez JS przyciski są zwykłymi linkami i filtr ustawia serwer.
(() => {
  const nav = document.getElementById('status-filter');
  const table = document.getElementById('orders-table');
  if (!nav || !table) return;

  const rows = [...table.querySelectorAll('tbody tr[data-status]')];
  const empty = document.getElementById('orders-empty');
  const count = document.getElementById('orders-count');

  const apply = (status) => {
    let shown = 0;
    rows.forEach((row) => {
      const visible = !status || row.dataset.status === status;
      row.classList.toggle('d-none', !visible);
      if (visible) shown += 1;
    });
    table.classList.toggle('d-none', shown === 0);
    if (empty) empty.classList.toggle('d-none', shown !== 0);
    if (count) count.textContent = status ? `${shown} z ${rows.length}` : String(rows.length);

    nav.querySelectorAll('a[data-status]').forEach((link) => {
      const active = link.dataset.status === status;
      link.classList.toggle('btn-secondary', active);
      link.classList.toggle('btn-outline-secondary', !active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  };

  nav.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-status]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    const status = link.dataset.status;
    apply(status);
    history.replaceState(null, '', link.href);
  });
})();
