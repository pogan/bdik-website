// Statystyki odwiedzin ze wspólnego pakietu vamude-kit (tabele vk_* w tej samej
// bazie): bez ciasteczek, z botami liczonymi osobno. Ruch administratora pomijamy,
// panel /kierownik/stats dla każdego zalogowanego administratora. Stara tabela
// visits nie ma już widoku: zawartość eksportuje scripts/eksport-starych-statystyk.js.
const { createStats } = require('vamude-kit');
const db = require('../db');
const { isAdmin } = require('./projection');

module.exports = createStats({
  db,
  exclude: (req) => isAdmin(req),
  guard: (req) => isAdmin(req),
});
