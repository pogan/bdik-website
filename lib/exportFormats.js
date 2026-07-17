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

const PDF_MARGIN = 24;
const PDF_ROW_HEIGHT = 18;
const PDF_FONT_SIZE = 8;
const PDF_CELL_PAD = 8;
// Kolumna nie zwęża się poniżej MIN (żeby "Nr domu" nie był paskiem) i nie
// rozpycha się powyżej MAX. Przy obecnych danych MAX obcina jedną nazwę na
// ~2200 - jest po to, żeby pojedyncza monstrualna wartość nie rozdęła strony.
const PDF_COL_MIN = 34;
const PDF_COL_MAX = 480;
// Twardy limit formatu PDF na wymiar strony (200 cali = 14400 pt).
const PDF_MAX_PAGE_WIDTH = 14400;
const PDF_PAGE_HEIGHT = 842; // wysokość A4/A3 poziomo - szerokość liczymy z danych

function cellText(value) {
  return value === null || value === undefined ? '' : String(value);
}

function streamPdf(res, rowIterator, columns) {
  const doc = new PDFDocument({ margin: PDF_MARGIN, autoFirstPage: false });
  doc.registerFont('body', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);
  doc.pipe(res);

  // Szerokość kolumn znamy dopiero po zobaczeniu najdłuższej wartości, a rozmiar
  // strony trzeba podać przy zakładaniu strony - dlatego wiersze materializujemy
  // zamiast przepuszczać strumieniem. Eksport to maksymalnie kilka tysięcy
  // rekordów o kilkunastu krótkich polach, więc mieści się w pamięci bez trudu.
  const rows = Array.from(rowIterator);

  function widthOf(text, font) {
    doc.font(font).fontSize(PDF_FONT_SIZE);
    return doc.widthOfString(cellText(text));
  }

  // Kolumna dostaje tyle, ile potrzebuje jej najdłuższa wartość - dzięki temu
  // "Nr domu" nie zabiera tyle samo co "Nazwa", a strona rośnie w szerokość
  // zamiast ucinać treść (stały A3 nie mieścił nawet wąskiego zestawu kolumn).
  const colWidths = columns.map((c) => {
    let widest = widthOf(c.label, 'bold');
    for (const row of rows) {
      const w = widthOf(row[c.key], 'body');
      if (w > widest) widest = w;
    }
    return Math.min(PDF_COL_MAX, Math.max(PDF_COL_MIN, Math.ceil(widest) + PDF_CELL_PAD));
  });

  const tableWidth = colWidths.reduce((sum, w) => sum + w, 0);
  const pageWidth = Math.min(PDF_MAX_PAGE_WIDTH, tableWidth + 2 * PDF_MARGIN);
  const startX = PDF_MARGIN;
  const usableWidth = pageWidth - 2 * PDF_MARGIN;
  // Lewa krawędź każdej kolumny - liczona raz, bo kolumny mają różne szerokości.
  const colX = [];
  colWidths.reduce((x, w, i) => { colX[i] = x; return x + w; }, startX);

  // Rezerwujemy dolny pas na stopkę licencyjną (rysowaną na każdej stronie).
  const footerHeight = 14;
  const pageBottom = PDF_PAGE_HEIGHT - PDF_MARGIN - footerHeight;

  function drawFooter() {
    doc
      .font('body')
      .fontSize(6)
      .fillColor('#888888')
      .text(LICENSE_FOOTER, startX, PDF_PAGE_HEIGHT - PDF_MARGIN - 10, {
        width: usableWidth,
        lineBreak: false,
        ellipsis: true,
      })
      .fillColor('#000000');
  }

  // Stopka na każdej stronie, łącznie z pierwszą - przy autoFirstPage: false
  // wszystkie strony zakłada newPage(), więc 'pageAdded' odpala się dla każdej.
  doc.on('pageAdded', drawFooter);

  function newPage() {
    doc.addPage({ size: [pageWidth, PDF_PAGE_HEIGHT], margin: PDF_MARGIN });
  }

  function drawHeaderRow(y) {
    doc.font('bold').fontSize(PDF_FONT_SIZE);
    columns.forEach((c, i) => {
      doc.text(c.label, colX[i], y, { width: colWidths[i] - 4, height: PDF_ROW_HEIGHT, ellipsis: true });
    });
    doc
      .moveTo(startX, y + PDF_ROW_HEIGHT - 2)
      .lineTo(startX + tableWidth, y + PDF_ROW_HEIGHT - 2)
      .strokeColor('#cccccc')
      .stroke();
    return y + PDF_ROW_HEIGHT;
  }

  newPage();
  let y = PDF_MARGIN;
  doc.font('bold').fontSize(14).text('Instytucje kultury - eksport', startX, y);
  y += 24;
  y = drawHeaderRow(y);

  doc.font('body').fontSize(PDF_FONT_SIZE);
  for (const row of rows) {
    if (y + PDF_ROW_HEIGHT > pageBottom) {
      newPage();
      y = PDF_MARGIN;
      y = drawHeaderRow(y);
      doc.font('body').fontSize(PDF_FONT_SIZE);
    }
    columns.forEach((c, i) => {
      doc.text(cellText(row[c.key]), colX[i], y, {
        width: colWidths[i] - 4,
        height: PDF_ROW_HEIGHT,
        ellipsis: true,
      });
    });
    y += PDF_ROW_HEIGHT;
  }

  doc.end();
}

module.exports = { streamCsv, streamXlsx, streamPdf };
