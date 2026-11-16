// Statystyki odwiedzin ze wspólnego pakietu vamude-kit (tabele vk_* w tej samej
// bazie): bez ciasteczek, z botami liczonymi osobno. Ruch administratora pomijamy,
// panel szczegółów (/admin/odwiedziny) tylko dla administratora. Stara tabela
// visits zostaje jako archiwum do wglądu w /admin/stats - nic już do niej nie pisze.
const { createStats } = require('vamude-kit');
const db = require('../db');
const { isAdmin } = require('./projection');

module.exports = createStats({
  db,
  exclude: (req) => isAdmin(req),
  guard: (req) => isAdmin(req),
  panelPath: '/admin/odwiedziny',
});
