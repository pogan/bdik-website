const crypto = require('crypto');
const db = require('../db');

// Adresy IP nie trafiają do bazy w jawnej postaci - tylko hash, wystarczający
// do policzenia unikalnych odwiedzających bez przechowywania danych osobowych.
function hashIp(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

const upsertVisit = db.prepare(`
  INSERT INTO visits (ip_hash) VALUES (?)
  ON CONFLICT(ip_hash) DO UPDATE SET last_seen = datetime('now')
`);
const countVisits = db.prepare('SELECT COUNT(*) AS n FROM visits');

function recordVisit(ip) {
  if (!ip) return;
  upsertVisit.run(hashIp(ip));
}

function visitCount() {
  return countVisits.get().n;
}

module.exports = { recordVisit, visitCount };
