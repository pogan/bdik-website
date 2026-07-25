(() => {
  // Kolumny darmowe (realne dane także dla niezalogowanych): lokalizacja +
  // adres pocztowy. Kolejność jak w tabeli.
  const PUBLIC_COLUMNS = [
    { key: 'name', label: 'Nazwa' },
    { key: 'voivodeship', label: 'Województwo' },
    { key: 'county', label: 'Powiat' },
    { key: 'locality', label: 'Miejscowość' },
    {
      key: 'address',
      label: 'Adres',
      render: (r) => [toTitleCase(r.street), r.building_no].filter(Boolean).join(' ') + (r.unit_no ? `/${r.unit_no}` : ''),
    },
    { key: 'postal_code', label: 'Kod pocztowy' },
  ];

  // Kolumny płatne (dla niezalogowanych zablurowane): dane kontaktowe + REGON.
  const GATED_COLUMNS = [
    { key: 'phone', label: 'Telefon' },
    { key: 'email', label: 'E-mail' },
    {
      key: 'website',
      label: 'WWW',
      render: (r) => (r.website ? `<a href="${escapeHtml(r.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.website)}</a>` : ''),
    },
    { key: 'regon', label: 'REGON' },
  ];

  const BLURRED_PLACEHOLDERS = ['+48 000 000 000', 'kontakt@przyklad.pl', 'www.przyklad.pl', '000000000'];

  const HIERARCHY = ['voivodeship', 'county', 'commune', 'locality'];
  const SELECT_IDS = { voivodeship: 'f-voivodeship', county: 'f-county', commune: 'f-commune', locality: 'f-locality' };

  // Widok administratora: pełna lista kolumn tabeli institutions wraz z trybem
  // filtrowania każdej z nich. Serwer wstawia go tylko dla admina (views/baza.ejs),
  // więc dla pozostałych użytkowników cała ta gałąź jest martwa.
  const ADMIN_VIEW = Array.isArray(window.BDIK_ADMIN_VIEW) ? window.BDIK_ADMIN_VIEW : null;

  // Wstępne zawężenie na stronach segmentów (/baza/wojewodztwo/:slug,
  // /baza/typ/:slug) - serwer wstawia np. { voivodeship: 'MAZOWIECKIE' } albo
  // { type: 'biblioteki' }. Pola filtrów zostają aktywne (nie disabled) - to
  // punkt wejścia, nie twardy limit.
  const INITIAL_FILTERS = window.BDIK_INITIAL_FILTERS && typeof window.BDIK_INITIAL_FILTERS === 'object'
    ? window.BDIK_INITIAL_FILTERS
    : {};

  const state = {
    voivodeship: '',
    county: '',
    commune: '',
    locality: '',
    // Filtr "tylko z danymi kontaktowymi" (any/phone/email/website albo '').
    contact: '',
    // Filtr typu instytucji (domy-kultury/centra-kultury/osrodki-kultury/biblioteki albo '').
    type: '',
    q: '',
    sort: 'name',
    order: 'asc',
    page: 1,
    pageSize: 25,
    // Wartości filtrów administratora, kluczowane nazwą kolumny.
    admin: {},
  };

  let searchDebounce = null;

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Polskie "słowa funkcyjne", które w środku nazwy zostają małą literą
  // (np. "Gminny Ośrodek Kultury w Zabłociu", "Biblioteka nad Wisłą").
  const LOWERCASE_WORDS = new Set([
    'w', 'we', 'i', 'oraz', 'na', 'do', 'z', 'ze', 'od', 'nad', 'pod', 'przy',
    'im', 'dla', 'o', 'a', 'lub', 'the', 'of',
  ]);

  // Rejestry (KRS/GUS) przechowują nazwy i lokalizacje WERSALIKAMI. Zamieniamy
  // je na normalną wielkość liter wyłącznie przy wyświetlaniu - dane z API
  // pozostają nietknięte. Wartości, które nie są w całości wielkimi literami
  // (np. e-mail, adres WWW), zostawiamy bez zmian.
  function toTitleCase(value) {
    if (typeof value !== 'string' || !value) return value;
    const letters = value.replace(/[^\p{L}]/gu, '');
    if (!letters || letters !== letters.toUpperCase()) return value;

    let wordIndex = 0;
    return value.toLowerCase().replace(/\p{L}[\p{L}’']*/gu, (word, offset) => {
      const isFirst = wordIndex === 0;
      wordIndex += 1;
      const prevChar = value[offset - 1];
      // Po myślniku zawsze kapitalizujemy (np. "Bielsko-Biała").
      if (!isFirst && prevChar !== '-' && LOWERCASE_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    });
  }

  // Statystyki stopki (widoczne tylko dla admina). sendBeacon zamiast fetch,
  // bo kliknięcie w "Pobierz przykład" od razu startuje pobieranie pliku.
  function track(name) {
    if (navigator.sendBeacon) navigator.sendBeacon(`/api/events/${name}`);
    else fetch(`/api/events/${name}`, { method: 'POST', keepalive: true });
  }

  // Zmiana filtra liczy osoby, nie kliknięcia - jedno zgłoszenie na wizytę
  // wystarczy, żeby nie strzelać przy każdym wciśniętym klawiszu w szukajce.
  let filterTracked = false;
  function trackFilterChange() {
    if (filterTracked) return;
    filterTracked = true;
    track('filter_change');
  }

  function buildQueryString(extra = {}) {
    const params = new URLSearchParams();
    for (const key of HIERARCHY) {
      if (state[key]) params.set(key, state[key]);
    }
    for (const [key, value] of Object.entries(state.admin)) {
      if (value) params.set(key, value);
    }
    if (state.contact) params.set('contact', state.contact);
    if (state.type) params.set('type', state.type);
    if (state.q) params.set('q', state.q);
    params.set('sort', state.sort);
    params.set('order', state.order);
    params.set('page', String(state.page));
    params.set('pageSize', String(state.pageSize));
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
    return params.toString();
  }

  async function loadFacet(level) {
    const filters = {};
    const levelIdx = HIERARCHY.indexOf(level);
    for (const key of HIERARCHY.slice(0, levelIdx)) {
      if (state[key]) filters[key] = state[key];
    }
    const params = new URLSearchParams(filters);
    const res = await fetch(`/api/institutions/facets/${level}?${params.toString()}`);
    const data = await res.json();
    const select = document.getElementById(SELECT_IDS[level]);
    const current = state[level];
    // value = oryginalna wartość z rejestru (wysyłana do backendu jako filtr),
    // tekst = ładniejsza wielkość liter tylko do wyświetlenia.
    select.innerHTML = '<option value="">Wszystkie</option>' + data.values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(toTitleCase(v))}</option>`).join('');
    select.value = data.values.includes(current) ? current : '';
    state[level] = select.value;
  }

  async function refreshFacetsBelow(changedLevel) {
    const idx = HIERARCHY.indexOf(changedLevel);
    for (const level of HIERARCHY.slice(idx + 1)) {
      state[level] = '';
      await loadFacet(level);
    }
  }

  // Badge (wypełnione/wszystkie) przy telefonie, e-mailu i WWW - od razu widać,
  // ile z odfiltrowanych instytucji ma dany kanał kontaktu.
  function renderCoverageBadge(key, coverage) {
    const stats = coverage && coverage.fields && coverage.fields[key];
    if (!stats || !coverage.total) return '';
    const ratio = stats.filled / coverage.total;
    const tone = ratio >= 0.7 ? 'success' : ratio >= 0.3 ? 'warning' : 'danger';
    const title = `${stats.filled} z ${coverage.total} wypełnionych, ${stats.empty} pustych`;
    return ` <span class="badge rounded-pill bg-${tone}-subtle text-${tone}-emphasis coverage-badge" title="${escapeHtml(title)}">${stats.filled}/${coverage.total}</span>`;
  }

  function renderCell(c, row) {
    return c.render ? c.render(row) : escapeHtml(toTitleCase(row[c.key] || ''));
  }

  // Pola zapisane w rejestrach wersalikami - tylko im poprawiamy wielkość liter.
  // Kolumny techniczne (nazwa znormalizowana, daty, identyfikatory) zostają
  // dokładnie takie, jakie są w bazie, bo administrator patrzy tu na surowe dane.
  const TITLE_CASE_FIELDS = new Set([
    'name', 'legal_form', 'voivodeship', 'county', 'commune', 'locality',
    'street', 'post_office', 'pkd_main_desc',
  ]);

  const ADMIN_RENDERERS = {
    regon_valid: (r) => (Number(r.regon_valid) === 1 ? 'tak' : 'nie'),
    website: (r) => (r.website ? `<a href="${escapeHtml(r.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.website)}</a>` : ''),
    email: (r) => (r.email ? `<a href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a>` : ''),
  };

  // Kolumny widoku administratora: wszystkie pola tabeli institutions, w
  // kolejności ze speca serwera.
  function adminColumns() {
    return ADMIN_VIEW.map((f) => ({
      key: f.key,
      label: f.label,
      sortable: Boolean(f.sortable),
      render: ADMIN_RENDERERS[f.key] || ((r) => {
        const value = r[f.key] === null || r[f.key] === undefined ? '' : String(r[f.key]);
        return escapeHtml(TITLE_CASE_FIELDS.has(f.key) ? toTitleCase(value) : value);
      }),
    }));
  }

  function visibleColumns() {
    if (ADMIN_VIEW) return adminColumns();
    return PUBLIC_COLUMNS.concat(GATED_COLUMNS).map((c) => ({
      ...c,
      sortable: ['name', 'voivodeship', 'county', 'commune', 'locality', 'postal_code'].includes(c.key),
    }));
  }

  function renderTableHead(authorized, coverage) {
    const columns = visibleColumns();
    const head = document.getElementById('table-head');
    head.innerHTML = columns
      .map((c, i) => {
        const lockIcon = !ADMIN_VIEW && !authorized && i >= PUBLIC_COLUMNS.length ? ' <i class="bi bi-lock-fill small"></i>' : '';
        const badge = renderCoverageBadge(c.key, coverage);
        return `<th${c.sortable ? ` data-sort="${c.key}" role="button"` : ''}>${c.label}${lockIcon}${badge}</th>`;
      })
      .join('');
  }

  function renderRow(row, authorized) {
    if (ADMIN_VIEW) {
      const cells = adminColumns().map((c) => `<td>${renderCell(c, row) || ''}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    }

    const cells = PUBLIC_COLUMNS.map((c) => `<td>${renderCell(c, row) || ''}</td>`);
    if (authorized) {
      GATED_COLUMNS.forEach((c) => {
        cells.push(`<td>${renderCell(c, row) || ''}</td>`);
      });
    } else {
      GATED_COLUMNS.forEach((c, i) => {
        cells.push(`<td class="blurred-cell">${BLURRED_PLACEHOLDERS[i % BLURRED_PLACEHOLDERS.length]}</td>`);
      });
    }
    return `<tr>${cells.join('')}</tr>`;
  }

  function renderPagination(total, page, pageSize) {
    const pageCount = Math.max(Math.ceil(total / pageSize), 1);
    const pagination = document.getElementById('pagination');
    const info = document.getElementById('page-info');
    info.textContent = `Strona ${page} z ${pageCount} · ${total} instytucji`;

    const items = [];
    const addItem = (label, targetPage, disabled, active) => {
      items.push(`<li class="page-item${disabled ? ' disabled' : ''}${active ? ' active' : ''}"><button class="page-link" data-page="${targetPage}">${label}</button></li>`);
    };
    addItem('«', page - 1, page <= 1, false);
    const start = Math.max(1, page - 2);
    const end = Math.min(pageCount, page + 2);
    for (let p = start; p <= end; p += 1) addItem(String(p), p, false, p === page);
    addItem('»', page + 1, page >= pageCount, false);
    pagination.innerHTML = items.join('');

    pagination.querySelectorAll('button[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = Number(btn.dataset.page);
        if (target < 1 || target > pageCount) return;
        state.page = target;
        fetchResults();
      });
    });
  }

  // Kryteria wysyłane do wyceny i zapisywane w zamówieniu. Muszą pokrywać się
  // z tym, co widać w tabeli - z nich serwer odtworzy plik po opłaceniu.
  function exportSelection(format) {
    const selection = { format, q: state.q, sort: state.sort, order: state.order };
    for (const key of HIERARCHY) {
      if (state[key]) selection[key] = state[key];
    }
    if (state.contact) selection.contact = state.contact;
    if (state.type) selection.type = state.type;
    // Filtry administratora też zawężają plik - inaczej eksport obejmowałby
    // szerszy zakres, niż widać w tabeli.
    for (const [key, value] of Object.entries(state.admin)) {
      if (value) selection[key] = value;
    }
    return selection;
  }

  // Eksport jest płatny, więc przyciski widzi każdy (także niezalogowany) -
  // bramką jest potwierdzona płatność, nie logowanie.
  function updateExportButtons(total) {
    document.querySelectorAll('#export-buttons button[data-format]').forEach((btn) => {
      btn.disabled = total === 0;
    });
  }

  // Cena eksportu bieżących filtrów, na żywo w karcie eksportu - klient zna
  // kwotę PRZED otwarciem modala płatności (kwoty liczy serwer, tu tylko tekst).
  function updateExportPrice(total, exportPrice) {
    const box = document.getElementById('export-price');
    if (!box) return;
    if (!total || !exportPrice) {
      box.classList.add('d-none');
      return;
    }
    const free = exportPrice.freeCount
      ? ` — płacisz za ${exportPrice.billedCount} rekordów z kontaktem, ${exportPrice.freeCount} gratis`
      : '';
    document.getElementById('export-price-text').textContent =
      `Eksport tych ${total} instytucji: ${exportPrice.grossLabel} brutto${free}`;
    box.classList.remove('d-none');
  }

  function attachExportHandlers() {
    document.querySelectorAll('#export-buttons button[data-format]').forEach((btn) => {
      btn.addEventListener('click', () => {
        track('export_modal');
        window.openCheckout(exportSelection(btn.dataset.format));
      });
    });
  }

  // Odpowiedzi nie wracają w kolejności wysłania - przy szybkim przełączaniu
  // filtrów wynik starszego zapytania potrafił nadpisać nowszy (tabela
  // pokazywała wtedy zakres niezgodny z ustawionymi filtrami). Rysujemy więc
  // tylko odpowiedź na ostatnie wysłane zapytanie.
  let requestSeq = 0;

  async function fetchResults() {
    const seq = (requestSeq += 1);
    const qs = buildQueryString();
    const res = await fetch(`/api/institutions?${qs}`);
    const data = await res.json();
    if (seq !== requestSeq) return;

    renderTableHead(data.authorized, data.coverage);
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = data.rows.length
      ? data.rows.map((row) => renderRow(row, data.authorized)).join('')
      : '<tr><td class="text-center text-secondary py-4">Brak wyników dla wybranych filtrów</td></tr>';

    document.getElementById('result-count').textContent = `${data.total} instytucji spełnia kryteria`;
    renderPagination(data.total, data.page, data.pageSize);
    updateExportButtons(data.total);
    updateExportPrice(data.total, data.exportPrice);

    document.querySelectorAll('#table-head th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (state.sort === col) {
          state.order = state.order === 'asc' ? 'desc' : 'asc';
        } else {
          state.sort = col;
          state.order = 'asc';
        }
        state.page = 1;
        fetchResults();
      });
    });
  }

  // --- Filtry administratora -------------------------------------------------

  const adminDebounce = {};

  function adminFilterFields() {
    return ADMIN_VIEW ? ADMIN_VIEW.filter((f) => f.filter) : [];
  }

  function adminFilterId(key) {
    return `af-${key}`;
  }

  function updateAdminFilterCount() {
    const badge = document.getElementById('admin-filters-count');
    if (!badge) return;
    const active = Object.values(state.admin).filter(Boolean).length;
    badge.textContent = String(active);
    badge.classList.toggle('d-none', active === 0);
  }

  // Kolumny słownikowe dostają select z wartościami z bazy (filtr dopasowuje
  // dokładnie), pozostałe - pole tekstowe szukające fragmentu.
  function renderAdminFilters() {
    const grid = document.getElementById('admin-filters-grid');
    if (!grid) return;

    grid.innerHTML = adminFilterFields()
      .map((f) => {
        const hint = f.filter === 'like' ? ' <span class="text-body-tertiary">(fragment)</span>' : '';
        const control =
          f.filter === 'facet'
            ? `<select class="form-select form-select-sm" id="${adminFilterId(f.key)}" data-admin-facet="${f.key}"><option value="">Wszystkie</option></select>`
            : `<input type="text" class="form-control form-control-sm" id="${adminFilterId(f.key)}" data-admin-filter="${f.key}" data-admin-mode="${f.filter}">`;
        return `<div class="col-6 col-md-3">
            <label class="form-label small text-secondary mb-1" for="${adminFilterId(f.key)}">${escapeHtml(f.label)}${hint}</label>
            ${control}
          </div>`;
      })
      .join('');
  }

  async function loadAdminFacet(key) {
    const select = document.getElementById(adminFilterId(key));
    if (!select) return;
    // Słowniki zawężamy bieżącą hierarchią - w wybranym województwie nie ma
    // sensu proponować form prawnych, których tam nie ma.
    const params = new URLSearchParams();
    for (const level of HIERARCHY) {
      if (state[level]) params.set(level, state[level]);
    }
    const res = await fetch(`/api/institutions/facets/${key}?${params.toString()}`);
    const data = await res.json();
    const current = state.admin[key] || '';
    select.innerHTML =
      '<option value="">Wszystkie</option>' +
      data.values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(toTitleCase(v))}</option>`).join('');
    select.value = data.values.includes(current) ? current : '';
    state.admin[key] = select.value;
  }

  function loadAdminFacets() {
    return Promise.all(adminFilterFields().filter((f) => f.filter === 'facet').map((f) => loadAdminFacet(f.key)));
  }

  function attachAdminFilterHandlers() {
    document.querySelectorAll('[data-admin-facet]').forEach((select) => {
      select.addEventListener('change', () => {
        state.admin[select.dataset.adminFacet] = select.value;
        state.page = 1;
        updateAdminFilterCount();
        fetchResults();
      });
    });

    document.querySelectorAll('[data-admin-filter]').forEach((input) => {
      const key = input.dataset.adminFilter;
      input.addEventListener('input', () => {
        clearTimeout(adminDebounce[key]);
        adminDebounce[key] = setTimeout(() => {
          state.admin[key] = input.value.trim();
          state.page = 1;
          updateAdminFilterCount();
          fetchResults();
        }, 300);
      });
    });
  }

  function resetAdminFilters() {
    state.admin = {};
    document.querySelectorAll('[data-admin-filter]').forEach((input) => { input.value = ''; });
    document.querySelectorAll('[data-admin-facet]').forEach((select) => { select.value = ''; });
    updateAdminFilterCount();
  }

  function attachFilterHandlers() {
    HIERARCHY.forEach((level) => {
      document.getElementById(SELECT_IDS[level]).addEventListener('change', async (e) => {
        trackFilterChange();
        state[level] = e.target.value;
        state.page = 1;
        await refreshFacetsBelow(level);
        // Słowniki admina zależą od hierarchii, więc przeładowujemy je razem z nią.
        if (ADMIN_VIEW) await loadAdminFacets();
        fetchResults();
      });
    });

    document.getElementById('f-contact').addEventListener('change', (e) => {
      trackFilterChange();
      state.contact = e.target.value;
      state.page = 1;
      fetchResults();
    });

    document.getElementById('f-type').addEventListener('change', (e) => {
      trackFilterChange();
      state.type = e.target.value;
      state.page = 1;
      fetchResults();
    });

    document.getElementById('f-search').addEventListener('input', (e) => {
      trackFilterChange();
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        state.q = e.target.value;
        state.page = 1;
        fetchResults();
      }, 300);
    });

    document.getElementById('f-reset').addEventListener('click', async () => {
      HIERARCHY.forEach((level) => { state[level] = ''; });
      state.q = '';
      state.contact = '';
      state.type = '';
      state.page = 1;
      document.getElementById('f-search').value = '';
      document.getElementById('f-contact').value = '';
      document.getElementById('f-type').value = '';
      resetAdminFilters();
      await loadFacet('voivodeship');
      await refreshFacetsBelow('voivodeship');
      if (ADMIN_VIEW) await loadAdminFacets();
      fetchResults();
    });
  }

  function attachSampleHandler() {
    const btn = document.getElementById('sample-download');
    if (btn) btn.addEventListener('click', () => track('sample_download'));
  }

  // Formularz "próbka na e-mail" (lead). Zgoda wymagana po stronie serwera,
  // ale sprawdzamy ją też tutaj, żeby komunikat był natychmiastowy.
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

  async function init() {
    // Scalone PRZED wczytaniem słowników - loadFacet('voivodeship') czyta
    // state.voivodeship, żeby zaznaczyć właściwą opcję i zawęzić kolejne
    // poziomy hierarchii (patrz refreshFacetsBelow/loadFacet).
    Object.assign(state, INITIAL_FILTERS);
    if (state.type) document.getElementById('f-type').value = state.type;

    attachSampleHandler();
    attachLeadHandler();
    if (ADMIN_VIEW) {
      renderAdminFilters();
      attachAdminFilterHandlers();
    }
    attachFilterHandlers();
    attachExportHandlers();
    await loadFacet('voivodeship');
    await loadFacet('county');
    await loadFacet('commune');
    await loadFacet('locality');
    if (ADMIN_VIEW) await loadAdminFacets();
    await fetchResults();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
