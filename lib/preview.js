// Podgląd dla klienta na STAGING (*.staging.vamude.com): PREVIEW_LOGIN=true sprawia,
// że logowanie do panelu zawsze się udaje, bez Google - na konto testowego
// administratora. Na każdym innym adresie (PUBLIC_BASE_URL) aplikacja odmawia
// startu, więc flaga nie zadziała na produkcji nawet przez pomyłkę.
const enabled = process.env.PREVIEW_LOGIN === 'true';
const PREVIEW_EMAIL = 'podglad@example.invalid';

function isPreviewHost(url) {
  try {
    const { hostname } = new URL(url);
    return hostname.endsWith('.staging.vamude.com') || hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function assertPreviewHost() {
  if (enabled && !isPreviewHost(process.env.PUBLIC_BASE_URL || '')) {
    throw new Error(
      `PREVIEW_LOGIN=true jest dozwolone tylko na podglądzie (*.staging.vamude.com), a PUBLIC_BASE_URL to "${process.env.PUBLIC_BASE_URL || ''}".`
    );
  }
}

// Konto testowego administratora - zakładane przy pierwszym logowaniu.
function previewUser(db) {
  db.prepare("INSERT OR IGNORE INTO users (email, role) VALUES (?, 'admin')").run(PREVIEW_EMAIL);
  db.prepare("UPDATE users SET role = 'admin', is_active = 1, last_login_at = datetime('now') WHERE email = ?").run(PREVIEW_EMAIL);
  return db.prepare('SELECT * FROM users WHERE email = ?').get(PREVIEW_EMAIL);
}

module.exports = { enabled, PREVIEW_EMAIL, isPreviewHost, assertPreviewHost, previewUser };
