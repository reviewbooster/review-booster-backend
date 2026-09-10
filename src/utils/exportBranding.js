'use strict';
/**
 * utils/exportBranding.js
 * Shared CSV/PDF export helpers so every export in the app (reviews,
 * customers, and any future ones) carries the same ReviewBooster + Adcend
 * branding, instead of each controller re-implementing it slightly
 * differently.
 */
const PDFDocument = require('pdfkit');

const BRAND_LINE = 'ReviewBooster \u2014 Powered by Adcend | Marketing Agency';

function csvCell(cell) {
  return '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"';
}

/**
 * buildBrandedCsv(title, header, rows) -> csv string
 * header: array of column names
 * rows:   array of arrays (same length as header)
 */
function buildBrandedCsv(title, header, rows) {
  var today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  var lines = [];
  lines.push(csvCell(title));
  lines.push(csvCell('Generated ' + today + ' \u00b7 ' + BRAND_LINE));
  lines.push('');
  lines.push(header.map(csvCell).join(','));
  rows.forEach(function(row) {
    lines.push(row.map(csvCell).join(','));
  });
  lines.push('');
  lines.push(csvCell(BRAND_LINE));
  return lines.join('\n');
}

/**
 * sendBrandedPdf(res, { title, header, rows, filename })
 * Streams a simple branded table PDF directly to the response.
 * Columns split evenly across the printable width; rows wrap and
 * paginate automatically.
 */
function sendBrandedPdf(res, opts) {
  var title    = opts.title;
  var header   = opts.header;
  var rows     = opts.rows;
  var filename = opts.filename;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

  var doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
  doc.pipe(res);

  var pageWidth  = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  var colWidth   = pageWidth / header.length;
  var today      = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  function drawHeaderBand() {
    doc.fontSize(16).fillColor('#7C3AED').text(title, { align: 'left' });
    doc.fontSize(9).fillColor('#888888').text('Generated ' + today + '  \u00b7  ' + BRAND_LINE);
    doc.moveDown(0.8);
    doc.fontSize(9).fillColor('#111111');
    var y = doc.y;
    header.forEach(function(h, i) {
      doc.font('Helvetica-Bold').text(String(h), doc.page.margins.left + i * colWidth, y, { width: colWidth - 6 });
    });
    doc.moveDown(0.6);
    doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor('#DDDDDD').stroke();
    doc.moveDown(0.4);
  }

  function drawFooterBand() {
    doc.fontSize(8).fillColor('#AAAAAA').text(BRAND_LINE, doc.page.margins.left, doc.page.height - doc.page.margins.bottom + 10, {
      width: pageWidth, align: 'center',
    });
  }

  drawHeaderBand();
  doc.font('Helvetica').fontSize(8.5).fillColor('#333333');

  rows.forEach(function(row) {
    var y = doc.y;
    var rowHeight = 16;

    if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 20) {
      drawFooterBand();
      doc.addPage();
      drawHeaderBand();
      doc.font('Helvetica').fontSize(8.5).fillColor('#333333');
      y = doc.y;
    }

    row.forEach(function(cell, i) {
      doc.text(String(cell == null ? '' : cell), doc.page.margins.left + i * colWidth, y, {
        width: colWidth - 6, height: rowHeight, ellipsis: true,
      });
    });
    doc.y = y + rowHeight;
  });

  drawFooterBand();
  doc.end();
}

module.exports = { buildBrandedCsv, sendBrandedPdf, BRAND_LINE };