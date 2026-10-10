// Wersja aplikacji pokazywana w stopce i w /healthz. Numer wydania z
// package.json (podbijany ręcznie: `npm version patch|minor|major`) plus skrót
// i data ostatniego commita - deploy to `git pull` + restart pm2, więc na
// serwerze jest .git i każdy deploy da się rozpoznać nawet bez podbicia numeru.
// Czytane RAZ przy starcie procesu; brak gita (albo błąd) nie blokuje startu -
// zostaje sam numer z package.json.
const { execFileSync } = require('child_process');
const path = require('path');
const { version } = require('../package.json');

const ROOT = path.join(__dirname, '..');

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function readVersion() {
  const commit = git(['rev-parse', '--short', 'HEAD']);
  const date = commit ? git(['log', '-1', '--format=%cs']) : null;
  // Niezacommitowane zmiany w śledzonych plikach (typowo lokalny dev).
  const dirty = commit ? Boolean(git(['status', '--porcelain', '--untracked-files=no'])) : false;
  const label = [`v${version}`, commit && `${commit}${dirty ? '-dirty' : ''}`, date].filter(Boolean).join(' · ');
  return { version, commit, date, dirty, label };
}

const APP_VERSION = readVersion();

module.exports = { APP_VERSION };
