const path = require('path');
const fs = require('fs');
const orders = require('./orders');
const { writeExportToFile } = require('./exportRun');

// Katalog na kopie zapasowe wygenerowanych plików. Leży w data/ (poza public/),
// więc express.static go NIE serwuje - dostęp mają tylko trasy administracyjne
// i pobranie po opłaceniu, nigdy bezpośredni URL.
const BACKUP_DIR = process.env.EXPORT_BACKUP_DIR || path.join(__dirname, '..', 'data', 'exports');

// Nazwa pliku = identyfikator transakcji Stripe (pi_...), czyli ten sam numer,
// po którym rozpoznajemy płatność przy reklamacji. Zamówienia sprzed integracji
// (bez pi) nazywamy tokenem - fallback, żeby nic nie zostało bez backupu.
function backupFilename(order) {
  const id = order.stripe_payment_intent || order.token;
  return `${id}.${order.format}`;
}

function backupPath(order) {
  return path.join(BACKUP_DIR, backupFilename(order));
}

// Zwraca ścieżkę do gotowego pliku kopii, generując go raz (idempotentnie).
// Kolejne wywołania dla tego samego zamówienia trafiają na istniejący plik.
async function ensureBackup(order) {
  const filePath = backupPath(order);
  if (fs.existsSync(filePath)) return filePath;

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const selection = orders.parseSelection(order);
  await writeExportToFile(filePath, { format: order.format, selection });
  return filePath;
}

// Wersja "fire and forget" do wpięcia zaraz po markPaid: kopia ma powstać w tle
// przy potwierdzeniu płatności, ale jej błąd nie może wywrócić obsługi webhooka
// ani odpowiedzi Stripe. Gdyby się nie udała, i tak dogeneruje ją ensureBackup
// przy pierwszym pobraniu.
function saveBackupSafe(order) {
  if (!order || order.status !== 'paid') return;
  ensureBackup(order).catch((err) => {
    console.error('Backup eksportu nie powstał dla', backupFilename(order), '-', err.message);
  });
}

module.exports = { BACKUP_DIR, backupPath, ensureBackup, saveBackupSafe };
