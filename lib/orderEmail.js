// Budowa treści e-maila potwierdzającego zakup - "trwały nośnik" wymagany przez
// art. 21 ustawy o prawach konsumenta. Czysta funkcja (bez I/O), żeby dała się
// przetestować jednostkowo. Kluczowe pouczenia (utrata prawa odstąpienia,
// licencja) są w treści wiadomości, nie tylko pod linkiem.
const { breakdownFromNet, formatAmount, describeFilters, FORMAT_LABELS } = require('./pricing');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// order - wiersz z bazy (amount = NETTO). options.downloadUrl - absolutny link do
// pobrania; options.seller - dane sprzedawcy; options.termsUrl - link do wersji
// regulaminu z chwili zakupu.
function buildConfirmationEmail(order, { downloadUrl, seller = {}, termsUrl } = {}) {
  const { net, vat, gross } = breakdownFromNet(order.amount);
  const formatLabel = FORMAT_LABELS[order.format] || order.format;
  const orderNumber = order.stripe_payment_intent || order.token;
  const scope = describeFilters({ ...JSON.parse(order.filters).filters, q: JSON.parse(order.filters).q });

  const subject = `Potwierdzenie zakupu — eksport ${formatLabel} (${order.row_count} instytucji)`;

  const lines = [
    'Dziękujemy za zakup w serwisie Baza Danych Instytucji Kultury.',
    '',
    `Numer zamówienia (podawaj przy reklamacji): ${orderNumber}`,
    `Format: ${formatLabel}`,
    `Zakres: ${scope}`,
    `Liczba rekordów: ${order.row_count}`,
    `Kwota: ${formatAmount(gross)} brutto (netto ${formatAmount(net)} + VAT ${formatAmount(vat)})`,
    '',
    'POBIERANIE PLIKU',
    downloadUrl ? `Link do pobrania (ważny 24 godziny, do 10 pobrań): ${downloadUrl}` : 'Link do pobrania znajdziesz na stronie potwierdzenia płatności.',
    '',
    'PRAWO ODSTĄPIENIA',
    'Zamówienie dotyczy treści cyfrowej dostarczanej niezwłocznie. Wyraziłeś/-aś zgodę na',
    'jej natychmiastowe dostarczenie i przyjąłeś/-ęłaś do wiadomości, że z chwilą rozpoczęcia',
    'pobierania tracisz prawo odstąpienia od umowy (art. 38 ust. 1 pkt 13 ustawy o prawach konsumenta).',
    '',
    'LICENCJA',
    'Plik przeznaczony jest wyłącznie do Twojego użytku własnego. Bez zgody sprzedawcy nie wolno',
    'go edytować w celu dalszego rozpowszechniania, upubliczniać ani odsprzedawać/udostępniać',
    'osobom trzecim. Dane pochodzą z publicznych rejestrów (m.in. KRS) i ręcznych uzupełnień;',
    'sprzedawca nie gwarantuje ich kompletności ani zgodności ze stanem faktycznym.',
    '',
    'REKLAMACJE',
    `Reklamacje: ${seller.email || ''} — podaj numer zamówienia.`,
    termsUrl ? `Regulamin (wersja z chwili zakupu): ${termsUrl}` : '',
    '',
    'SPRZEDAWCA',
    seller.name || '',
    seller.address || '',
    seller.nip ? `NIP: ${seller.nip}` : '',
    seller.email || '',
  ].filter((l) => l !== null && l !== undefined);

  const text = lines.join('\n');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5">
      <p>Dziękujemy za zakup w serwisie <strong>Baza Danych Instytucji Kultury</strong>.</p>
      <table style="border-collapse:collapse">
        <tr><td style="padding:2px 8px;color:#666">Numer zamówienia</td><td style="padding:2px 8px"><code>${escapeHtml(orderNumber)}</code></td></tr>
        <tr><td style="padding:2px 8px;color:#666">Format</td><td style="padding:2px 8px">${escapeHtml(formatLabel)}</td></tr>
        <tr><td style="padding:2px 8px;color:#666">Zakres</td><td style="padding:2px 8px">${escapeHtml(scope)}</td></tr>
        <tr><td style="padding:2px 8px;color:#666">Liczba rekordów</td><td style="padding:2px 8px">${escapeHtml(order.row_count)}</td></tr>
        <tr><td style="padding:2px 8px;color:#666">Kwota</td><td style="padding:2px 8px"><strong>${escapeHtml(formatAmount(gross))}</strong> brutto (netto ${escapeHtml(formatAmount(net))} + VAT ${escapeHtml(formatAmount(vat))})</td></tr>
      </table>
      ${downloadUrl ? `<p><a href="${escapeHtml(downloadUrl)}" style="display:inline-block;padding:10px 16px;background:#0d6efd;color:#fff;text-decoration:none;border-radius:6px">Pobierz plik</a><br><span style="color:#666">Link ważny 24 godziny, do 10 pobrań.</span></p>` : '<p>Link do pobrania znajdziesz na stronie potwierdzenia płatności.</p>'}
      <h3 style="font-size:14px;margin:16px 0 4px">Prawo odstąpienia</h3>
      <p style="color:#444">Zamówienie dotyczy treści cyfrowej dostarczanej niezwłocznie. Wyrażono zgodę na jej natychmiastowe dostarczenie oraz przyjęto do wiadomości, że z chwilą rozpoczęcia pobierania <strong>prawo odstąpienia wygasa</strong> (art. 38 ust. 1 pkt 13 ustawy o prawach konsumenta).</p>
      <h3 style="font-size:14px;margin:16px 0 4px">Licencja</h3>
      <p style="color:#444">Plik wyłącznie do użytku własnego — bez edycji w celu rozpowszechniania, upubliczniania ani odsprzedaży/udostępniania osobom trzecim. Dane pochodzą z publicznych rejestrów (m.in. KRS) i ręcznych uzupełnień; sprzedawca nie gwarantuje ich kompletności ani zgodności ze stanem faktycznym.</p>
      <h3 style="font-size:14px;margin:16px 0 4px">Reklamacje</h3>
      <p style="color:#444">Reklamacje: <a href="mailto:${escapeHtml(seller.email || '')}">${escapeHtml(seller.email || '')}</a> — podaj numer zamówienia.${termsUrl ? ` <a href="${escapeHtml(termsUrl)}">Regulamin (wersja z chwili zakupu)</a>.` : ''}</p>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
      <p style="color:#666;font-size:12px">
        ${escapeHtml(seller.name || '')}<br>
        ${seller.address ? escapeHtml(seller.address) + '<br>' : ''}
        ${seller.nip ? 'NIP: ' + escapeHtml(seller.nip) + '<br>' : ''}
        ${escapeHtml(seller.email || '')}
      </p>
    </div>`;

  return { subject, text, html };
}

module.exports = { buildConfirmationEmail };
