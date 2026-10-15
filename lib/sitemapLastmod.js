// <lastmod> w sitemap.xml liczony per strona z jej faktycznej treści, a nie
// jedną globalną datą aktualizacji danych. Wcześniej ~175 z 180 adresów miało
// ten sam lastmod (data ostatniego ETL), także gdy dana strona się nie zmieniła -
// Google uczy się wtedy, że lastmod w tej sitemapie jest bezwartościowy.
//
// Każda strona podaje "sygnaturę" (string opisujący to, co renderuje: lista
// instytucji, liczniki, wersja szablonu). Hash sygnatury i data jej ostatniej
// zmiany trzymamy w pliku JSON obok bazy (data/<baza>.lastmod.json, poza gitem):
// data przesuwa się tylko wtedy, gdy hash się zmieni.
const fs = require('fs');
const crypto = require('crypto');

const hash = (value) => crypto.createHash('sha1').update(String(value)).digest('hex');

function readState(statePath) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
}

// entries: [{ path, signature }] -> Map(path -> 'YYYY-MM-DD'). Zapis stanu jest
// best-effort: brak uprawnień do zapisu nie może wywrócić startu serwera, wtedy
// po prostu kolejny start policzy daty jeszcze raz.
function resolveLastmods(entries, { statePath, today = new Date().toISOString().slice(0, 10) }) {
  const state = readState(statePath);
  const out = new Map();
  let changed = false;
  for (const { path, signature } of entries) {
    const h = hash(signature);
    const prev = state[path];
    if (prev && prev.hash === h && prev.date) {
      out.set(path, prev.date);
    } else {
      state[path] = { hash: h, date: today };
      out.set(path, today);
      changed = true;
    }
  }
  if (changed) {
    try {
      fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    } catch {
      /* best-effort, patrz komentarz wyżej */
    }
  }
  return out;
}

module.exports = { resolveLastmods };
