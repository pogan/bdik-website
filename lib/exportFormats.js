const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { seller } = require('./sellerInfo');

// Nota licencyjna dołączana do plików eksportu, żeby zakres uprawnień był przy
// samych danych, nie tylko w regulaminie/e-mailu.
const LICENSE_LINES = [
  'Licencja: plik wyłącznie do użytku własnego nabywcy. Zakaz edycji w celu rozpowszechniania,',
  'upubliczniania oraz odsprzedaży/udostępniania osobom trzecim bez zgody sprzedawcy.',
  'Dane pochodzą z publicznych rejestrów (m.in. KRS) i ręcznych uzupełnień - bez gwarancji',
  'kompletności i zgodności ze stanem faktycznym (część rekordów bez telefonu/e-maila/WWW).',
];
const LICENSE_FOOTER = `Licencja: użytek własny, bez edycji/upubliczniania/odsprzedaży. Dane z rejestrów publicznych (m.in. KRS) i uzupełnień - bez gwarancji zgodności.${seller.name ? ' © ' + seller.name : ''}`;

const FONT_REGULAR = path.join(__dirname, '..', 'node_modules', 'dejavu-fonts-ttf', 'ttf', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'node_modules', 'dejavu-fonts-ttf', 'ttf', 'DejaVuSans-Bold.ttf');

// Kolumny, dla których Excel/PDF nie mogą samodzielnie "zgadywać" typu liczbowego -
// REGON i kod pocztowy tracą wiodące zera, jeśli trafią do komórki numerycznej.
const TEXT_COLUMNS = new Set(['regon', 'nip', 'postal_code']);

function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/["\n\r,]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Strumieniowo - jeden wiersz na raz, bez budowania całości w pamięci.
function streamCsv(res, rowIterator, columns) {
  res.write('﻿'); // BOM, żeby Excel poprawnie rozpoznał UTF-8
  res.write(`${columns.map((c) => csvEscape(c.label)).join(',')}\r\n`);
  for (const row of rowIterator) {
    res.write(`${columns.map((c) => csvEscape(row[c.key])).join(',')}\r\n`);
  }
  res.end();
}

async function streamXlsx(res, rowIterator, columns) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });

  // Arkusz z licencją i informacją o pochodzeniu danych - komitowany przed danymi
  // (WorkbookWriter zapisuje arkusze strumieniowo w kolejności commitów).
  const licenseSheet = workbook.addWorksheet('Licencja');
  LICENSE_LINES.forEach((line) => licenseSheet.addRow([line]).commit());
  if (seller.name) licenseSheet.addRow([`Sprzedawca: ${seller.name}${seller.nip ? ', NIP ' + seller.nip : ''}`]).commit();
  licenseSheet.commit();

  const sheet = workbook.addWorksheet('Instytucje');
  sheet.columns = columns.map((c) => ({ header: c.label, key: c.key, width: 22 }));

  for (const row of rowIterator) {
    const excelRow = sheet.addRow(row);
    columns.forEach((c, idx) => {
      if (TEXT_COLUMNS.has(c.key)) {
        excelRow.getCell(idx + 1).numFmt = '@';
      }
    });
    excelRow.commit();
  }

  sheet.commit();
  await workbook.commit();
}

function streamPdf(res, rowIterator, columns) {
  const doc = new PDFDocument({ margin: 24, size: 'A3', layout: 'landscape' });
  doc.registerFont('body', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);
  doc.pipe(res);

  const startX = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = usableWidth / columns.length;
  const rowHeight = 18;
  const fontSize = 8;
  // Rezerwujemy dolny pas na stopkę licencyjną (rysowaną na każdej stronie).
  const footerHeight = 14;
  const pageBottom = doc.page.height - doc.page.margins.bottom - footerHeight;

  function drawFooter() {
    doc
      .font('body')
      .fontSize(6)
      .fillColor('#888888')
      .text(LICENSE_FOOTER, startX, doc.page.height - doc.page.margins.bottom - 10, {
        width: usableWidth,
        lineBreak: false,
        ellipsis: true,
      })
      .fillColor('#000000');
  }

  // Stopka na stronach dokładanych w trakcie (addPage w pętli). Pierwszą stronę
  // stopkujemy ręcznie niżej, bo 'pageAdded' nie odpala się dla niej.
  doc.on('pageAdded', drawFooter);

  function drawHeaderRow(y) {
    doc.font('bold').fontSize(fontSize);
    columns.forEach((c, i) => {
      doc.text(c.label, startX + i * colWidth, y, { width: colWidth - 4, height: rowHeight, ellipsis: true });
    });
    doc
      .moveTo(startX, y + rowHeight - 2)
      .lineTo(startX + usableWidth, y + rowHeight - 2)
      .strokeColor('#cccccc')
      .stroke();
    return y + rowHeight;
  }

  drawFooter(); // pierwsza strona
  let y = doc.page.margins.top;
  doc.font('bold').fontSize(14).text('Instytucje kultury - eksport', startX, y);
  y += 24;
  y = drawHeaderRow(y);

  doc.font('body').fontSize(fontSize);
  for (const row of rowIterator) {
    if (y + rowHeight > pageBottom) {
      doc.addPage();
      y = doc.page.margins.top;
      y = drawHeaderRow(y);
      doc.font('body').fontSize(fontSize);
    }
    columns.forEach((c, i) => {
      const value = row[c.key];
      doc.text(value === null || value === undefined ? '' : String(value), startX + i * colWidth, y, {
        width: colWidth - 4,
        height: rowHeight,
        ellipsis: true,
      });
    });
    y += rowHeight;
  }

  doc.end();
}

module.exports = { streamCsv, streamXlsx, streamPdf };
