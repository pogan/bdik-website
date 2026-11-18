// Statystyki odwiedzin ze wspólnego pakietu vamude-kit (tabele vk_* w tej samej
// bazie): bez ciasteczek, z botami liczonymi osobno. Ruch administratora pomijamy,
// panel /kierownik/stats dla każdego zalogowanego administratora, z sekcjami
// sprzedaży (lib/campaignStats.js). Stara tabela
// visits nie ma już widoku: zawartość eksportuje scripts/eksport-starych-statystyk.js.
const { createStats } = require('vamude-kit');
const db = require('../db');
const { isAdmin } = require('./projection');

module.exports = createStats({
  db,
  exclude: (req) => isAdmin(req),
  guard: (req) => isAdmin(req),
  // Lejek sprzedaży, źródła zamówień i wyceny dla okresu wybranego w panelu
  // (lib/campaignStats.js; require leniwie, bo tamten moduł korzysta z tego).
  sections: (ctx) => require('./campaignStats').render(ctx),
});
