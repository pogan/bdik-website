(() => {
  const PUBLIC_COLUMNS = [
    { key: 'name', label: 'Nazwa' },
    { key: 'voivodeship', label: 'Województwo' },
    { key: 'locality', label: 'Miejscowość' },
  ];

  const EXTRA_COLUMNS = [
    { key: 'county', label: 'Powiat' },
    {
      key: 'address',
      label: 'Adres',
      render: (r) => [r.street, r.building_no].filter(Boolean).join(' ') + (r.unit_no ? `/${r.unit_no}` : ''),
    },
    { key: 'postal_code', label: 'Kod pocztowy' },
    { key: 'phone', label: 'Telefon' },
    { key: 'email', label: 'E-mail' },
    {
      key: 'website',
      label: 'WWW',
      render: (r) => (r.website ? `<a href="${escapeHtml(r.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.website)}</a>` : ''),
    },
    { key: 'regon', label: 'REGON' },
  ];

  const BLURRED_PLACEHOLDERS = ['Powiat Przykładowy', 'ul. Przykładowa 12', '00-000', '+48 000 000 000', 'kontakt@przyklad.pl', 'www.przyklad.pl', '000000000'];

  const HIERARCHY = ['voivodeship', 'county', 'commune', 'locality'];
  const SELECT_IDS = { voivodeship: 'f-voivodeship', county: 'f-county', commune: 'f-commune', locality: 'f-locality' };

  const state = {
    voivodeship: '',
    county: '',
    commune: '',
    locality: '',
    q: '',
    sort: 'name',
    order: 'asc',
    page: 1,
    pageSize: 25,
  };

  let searchDebounce = null;

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function buildQueryString(extra = {}) {
    const params = new URLSearchParams();
    for (const key of HIERARCHY) {
      if (state[key]) params.set(key, state[key]);
    }
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
    select.innerHTML = '<option value="">Wszystkie</option>' + data.values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
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

  function renderTableHead(authorized, coverage) {
    const columns = PUBLIC_COLUMNS.concat(EXTRA_COLUMNS);
    const head = document.getElementById('table-head');
    head.innerHTML = columns
      .map((c, i) => {
        const sortable = ['name', 'voivodeship', 'county', 'commune', 'locality', 'postal_code'].includes(c.key);
        const lockIcon = !authorized && i >= PUBLIC_COLUMNS.length ? ' <i class="bi bi-lock-fill small"></i>' : '';
        const badge = renderCoverageBadge(c.key, coverage);
        return `<th${sortable ? ` data-sort="${c.key}" role="button"` : ''}>${c.label}${lockIcon}${badge}</th>`;
      })
      .join('');
  }

  function renderRow(row, authorized) {
    const cells = PUBLIC_COLUMNS.map((c) => `<td>${escapeHtml(row[c.key] || '')}</td>`);
    if (authorized) {
      EXTRA_COLUMNS.forEach((c) => {
        const value = c.render ? c.render(row) : escapeHtml(row[c.key] || '');
        cells.push(`<td>${value || ''}</td>`);
      });
    } else {
      EXTRA_COLUMNS.forEach((c, i) => {
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

  function updateExportLinks(authorized) {
    const container = document.getElementById('export-buttons');
    container.hidden = !authorized;
    if (!authorized) return;
    container.querySelectorAll('a[data-format]').forEach((a) => {
      const qs = buildQueryString({ format: a.dataset.format });
      a.href = `/api/institutions/export?${qs}`;
    });
  }

  async function fetchResults() {
    const qs = buildQueryString();
    const res = await fetch(`/api/institutions?${qs}`);
    const data = await res.json();

    renderTableHead(data.authorized, data.coverage);
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = data.rows.length
      ? data.rows.map((row) => renderRow(row, data.authorized)).join('')
      : '<tr><td class="text-center text-secondary py-4">Brak wyników dla wybranych filtrów</td></tr>';

    document.getElementById('result-count').textContent = `${data.total} instytucji spełnia kryteria`;
    renderPagination(data.total, data.page, data.pageSize);
    updateExportLinks(data.authorized);

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

  function attachFilterHandlers() {
    HIERARCHY.forEach((level) => {
      document.getElementById(SELECT_IDS[level]).addEventListener('change', async (e) => {
        state[level] = e.target.value;
        state.page = 1;
        await refreshFacetsBelow(level);
        fetchResults();
      });
    });

    document.getElementById('f-search').addEventListener('input', (e) => {
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
      state.page = 1;
      document.getElementById('f-search').value = '';
      await loadFacet('voivodeship');
      await refreshFacetsBelow('voivodeship');
      fetchResults();
    });
  }

  async function init() {
    attachFilterHandlers();
    await loadFacet('voivodeship');
    await loadFacet('county');
    await loadFacet('commune');
    await loadFacet('locality');
    await fetchResults();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
