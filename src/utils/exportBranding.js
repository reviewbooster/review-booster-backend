'use strict';
/**
 * utils/exportBranding.js
 * Shared CSV/PDF export helpers so every export in the app (reviews,
 * customers, the Analytics report, and any future ones) carries the same
 * two-brand header: ReviewBooster's own logo, and the business's own name
 * + logo (when they've set one) + brand color accent -- instead of each
 * controller re-implementing it slightly differently.
 */
const PDFDocument = require('pdfkit');
const https = require('https');
const http  = require('http');
const path  = require('path');

const BRAND_LINE   = 'ReviewBooster \u2014 Powered by Adcend | Marketing Agency';
const BRAND_PURPLE = '#7C3AED';
const LOGO_PATH    = path.join(__dirname, '../assets/logo-lockup.png');
const LOGO_ASPECT  = 350 / 105; // logo-lockup.png is 350x105

function csvCell(cell) {
  return '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"';
}

/**
 * buildBrandedCsv(title, header, rows, business) -> csv string
 * business (optional): { name } -- CSV has no visual branding beyond text,
 * so only the business name is worth adding alongside the report title.
 */
function buildBrandedCsv(title, header, rows, business) {
  var today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  var lines = [];
  lines.push(csvCell(title));
  if (business && business.name) {
    lines.push(csvCell(business.name));
  }
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
 * fetchImageBuffer(url) -> Promise<Buffer|null>
 * Pulls in a business's own uploaded logo (brand_logo_url, usually
 * Cloudinary) before PDF drawing starts -- PDFKit's drawing calls are
 * synchronous, so any remote image has to be fetched up front. Resolves to
 * null (never rejects) on any failure, timeout, oversized response, or bad
 * status code -- a slow or broken logo URL should never break an export,
 * just fall back to text-only branding for that business.
 */
function fetchImageBuffer(url) {
  return new Promise(function(resolve) {
    if (!url || typeof url !== 'string') return resolve(null);
    var client = url.indexOf('https:') === 0 ? https : (url.indexOf('http:') === 0 ? http : null);
    if (!client) return resolve(null);

    var req = client.get(url, { timeout: 5000 }, function(res) {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      var chunks = [];
      var total = 0;
      var MAX_BYTES = 5 * 1024 * 1024; // 5MB safety cap
      res.on('data', function(chunk) {
        total += chunk.length;
        if (total > MAX_BYTES) { req.destroy(); resolve(null); return; }
        chunks.push(chunk);
      });
      res.on('end', function() { resolve(Buffer.concat(chunks)); });
      res.on('error', function() { resolve(null); });
    });
    req.on('timeout', function() { req.destroy(); resolve(null); });
    req.on('error', function() { resolve(null); });
  });
}

/**
 * drawBrandHeader(doc, { title, business, businessLogoBuffer, pageWidth })
 * Shared two-brand header used by every PDF export: ReviewBooster's own
 * logo-lockup top-left, the business's name (and logo, if they've set one)
 * top-right, a brand-color accent rule, then the report title + generated
 * date. Returns the Y position just below the header so callers know
 * where to start drawing their own content.
 */
function drawBrandHeader(doc, opts) {
  var title              = opts.title;
  var business           = opts.business || null;
  var businessLogoBuffer = opts.businessLogoBuffer || null;
  var pageWidth          = opts.pageWidth;
  var left               = doc.page.margins.left;
  var top                = doc.page.margins.top;
  var accentColor        = (business && business.brand_color) || BRAND_PURPLE;
  var today              = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  var logoWidth  = 110;
  var logoHeight = logoWidth / LOGO_ASPECT;
  try {
    doc.image(LOGO_PATH, left, top, { width: logoWidth });
  } catch (e) {
    // Missing/unreadable asset file -- fall back to text so export still works.
    doc.font('Helvetica-Bold').fontSize(13).fillColor(BRAND_PURPLE).text('ReviewBooster', left, top);
  }

  if (business && business.name) {
    var bizBlockWidth = 220;
    var bizX = left + pageWidth - bizBlockWidth;
    if (businessLogoBuffer) {
      try {
        doc.image(businessLogoBuffer, bizX + bizBlockWidth - 40, top, { width: 40, height: 40, fit: [40, 40] });
      } catch (e) { /* unreadable image data -- skip, business name still renders */ }
    }
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111111')
      .text(business.name, bizX, top + 2, { width: businessLogoBuffer ? bizBlockWidth - 48 : bizBlockWidth, align: 'right' });
  }

  var bandY = top + Math.max(logoHeight, 40) + 10;
  doc.moveTo(left, bandY).lineTo(left + pageWidth, bandY).lineWidth(2).strokeColor(accentColor).stroke();
  doc.lineWidth(1);

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111111').text(title, left, bandY + 12);
  doc.font('Helvetica').fontSize(8.5).fillColor('#888888').text('Generated ' + today, left, doc.y + 2);

  return doc.y + 10;
}

function drawBrandFooter(doc, pageWidth) {
  // The footer is drawn inside the bottom margin on purpose. PDFKit's
  // built-in "does this fit" check uses page.margins.bottom as the hard
  // boundary and will silently start a brand-new page rather than draw
  // text past it -- so we temporarily tell it there's no bottom margin for
  // this one draw call, then restore the real value right after.
  var realBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.fontSize(8).fillColor('#AAAAAA').text(BRAND_LINE, doc.page.margins.left, doc.page.height - realBottomMargin + 10, {
    width: pageWidth, align: 'center',
  });
  doc.page.margins.bottom = realBottomMargin;
}

/**
 * sendBrandedPdf(res, { title, header, rows, filename, business, businessLogoBuffer })
 * Streams a branded table PDF (used by Reviews/Customers exports).
 * business/businessLogoBuffer are optional -- a caller that hasn't been
 * updated to pass them still works, just without that business's own
 * branding in the header.
 */
function sendBrandedPdf(res, opts) {
  var title             = opts.title;
  var header            = opts.header;
  var rows              = opts.rows;
  var filename          = opts.filename;
  var business          = opts.business || null;
  var businessLogoBuffer = opts.businessLogoBuffer || null;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

  // bufferPages lets us loop over every real page at the end and stamp a
  // footer on each one -- including any page PDFKit creates automatically
  // on its own (e.g. a text block overflowing mid-draw), which our own
  // addPage() calls below can't anticipate or catch by themselves.
  var doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape', bufferPages: true });
  doc.pipe(res);

  var pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  var colWidth  = pageWidth / header.length;

  function drawHeaderBand() {
    doc.y = drawBrandHeader(doc, { title: title, business: business, businessLogoBuffer: businessLogoBuffer, pageWidth: pageWidth });
    doc.fontSize(9).fillColor('#111111');
    var rowY = doc.y;
    header.forEach(function(h, i) {
      doc.font('Helvetica-Bold').text(String(h), doc.page.margins.left + i * colWidth, rowY, { width: colWidth - 6 });
    });
    doc.moveDown(0.6);
    doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor('#DDDDDD').stroke();
    doc.moveDown(0.4);
  }

  drawHeaderBand();
  doc.font('Helvetica').fontSize(8.5).fillColor('#333333');

  rows.forEach(function(row) {
    var y = doc.y;
    var rowHeight = 16;

    if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 20) {
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

  var pageRange = doc.bufferedPageRange();
  for (var i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
    doc.switchToPage(i);
    drawBrandFooter(doc, pageWidth);
  }

  doc.end();
}

/* --- Analytics report section drawers -------------------------------- */

function sectionTitle(doc, text) {
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111').text(text, doc.page.margins.left, doc.y);
  doc.moveDown(0.4);
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom - 30) {
    doc.addPage();
    doc.y = doc.page.margins.top;
  }
}

function drawKpiGrid(doc, items, pageWidth) {
  var cols       = 3;
  var gap        = 10;
  var tileWidth  = (pageWidth - gap * (cols - 1)) / cols;
  var tileHeight = 52;
  var left       = doc.page.margins.left;
  var startY     = doc.y;

  items.forEach(function(item, i) {
    var col = i % cols;
    var row = Math.floor(i / cols);
    var x = left + col * (tileWidth + gap);
    var y = startY + row * (tileHeight + gap);
    doc.roundedRect(x, y, tileWidth, tileHeight, 6).fillColor('#F9FAFB').fill();
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#111111').text(String(item.value), x + 10, y + 10, { width: tileWidth - 20 });
    doc.font('Helvetica').fontSize(8).fillColor('#888888').text(item.label, x + 10, y + 30, { width: tileWidth - 20 });
  });

  var rowCount = Math.ceil(items.length / cols);
  doc.y = startY + rowCount * (tileHeight + gap);
}

function drawBarRows(doc, rows, pageWidth, barColor) {
  var left        = doc.page.margins.left;
  var labelWidth  = 110;
  var valueWidth  = 40;
  var pctWidth    = 40;
  var barWidth    = pageWidth - labelWidth - valueWidth - pctWidth - 16;
  var maxValue    = Math.max.apply(null, rows.map(function(r) { return r.value; }).concat([1]));

  rows.forEach(function(row) {
    var y = doc.y;
    var barLen = maxValue > 0 ? (row.value / maxValue) * barWidth : 0;
    doc.font('Helvetica').fontSize(9).fillColor('#555555').text(row.label, left, y + 2, { width: labelWidth });
    doc.roundedRect(left + labelWidth, y, barWidth, 7, 3).fillColor('#F3F4F6').fill();
    if (barLen > 0) {
      doc.roundedRect(left + labelWidth, y, barLen, 7, 3).fillColor(row.color || barColor).fill();
    }
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111111').text(String(row.value), left + labelWidth + barWidth + 6, y + 1, { width: valueWidth, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor('#999999').text((row.pct != null ? row.pct + '%' : ''), left + labelWidth + barWidth + 6 + valueWidth, y + 1, { width: pctWidth, align: 'right' });
    doc.y = y + 16;
  });
}

function drawChannelTable(doc, rows, pageWidth) {
  var left       = doc.page.margins.left;
  var colWidths  = [pageWidth * 0.3, pageWidth * 0.233, pageWidth * 0.233, pageWidth * 0.233];
  var headers    = ['Channel', 'Requests', 'Reviews', 'Conv.'];

  var y = doc.y;
  var x = left;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#888888');
  headers.forEach(function(h, i) {
    doc.text(h, x, y, { width: colWidths[i], align: i === 0 ? 'left' : 'right' });
    x += colWidths[i];
  });
  doc.moveDown(0.5);
  doc.moveTo(left, doc.y).lineTo(left + pageWidth, doc.y).strokeColor('#EEEEEE').stroke();
  doc.moveDown(0.3);

  rows.forEach(function(row) {
    var ry = doc.y;
    x = left;
    doc.font('Helvetica').fontSize(9).fillColor('#333333');
    var cells = [row.label, String(row.sent), String(row.reviews), Math.round(row.conversion_rate * 100) + '%'];
    cells.forEach(function(c, i) {
      doc.text(c, x, ry, { width: colWidths[i], align: i === 0 ? 'left' : 'right' });
      x += colWidths[i];
    });
    doc.y = ry + 15;
  });
}

function drawParagraph(doc, text, pageWidth) {
  doc.font('Helvetica').fontSize(10).fillColor('#333333').text(text, doc.page.margins.left, doc.y, { width: pageWidth, lineGap: 2 });
}

function drawOpportunities(doc, items, pageWidth) {
  var left = doc.page.margins.left;
  items.forEach(function(text) {
    var y = doc.y;
    doc.roundedRect(left, y + 4, 4, 4, 1).fillColor(BRAND_PURPLE).fill();
    doc.font('Helvetica').fontSize(9.5).fillColor('#333333').text(text, left + 12, y, { width: pageWidth - 12, lineGap: 1.5 });
    doc.moveDown(0.5);
  });
}

function drawThemeLists(doc, positive, negative, pageWidth) {
  var left     = doc.page.margins.left;
  var colWidth = (pageWidth - 20) / 2;
  var startY   = doc.y;

  function drawList(title, items, x) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111').text(title, x, startY, { width: colWidth });
    var y = startY + 16;
    if (items.length === 0) {
      doc.font('Helvetica').fontSize(8.5).fillColor('#999999').text('Not enough data yet.', x, y, { width: colWidth });
      return y + 14;
    }
    items.forEach(function(item) {
      doc.font('Helvetica').fontSize(9).fillColor('#444444').text(item.label, x, y, { width: colWidth - 30 });
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#666666').text(String(item.count), x + colWidth - 26, y, { width: 26, align: 'right' });
      y += 14;
    });
    return y;
  }

  var yLeft  = drawList('Top Positive Themes', positive, left);
  var yRight = drawList('Top Issues', negative, left + colWidth + 20);
  doc.y = Math.max(yLeft, yRight) + 4;
}

/**
 * sendAnalyticsReportPdf(res, { business, businessLogoBuffer, periodLabel,
 *   summary, themeSummary, filename })
 * A real multi-section analytics report -- Executive Overview, Review
 * Funnel, Rating Breakdown, Channel Performance, Top Feedback Topics --
 * not just a flat table. Every number comes from the same summary payload
 * the Analytics page itself renders, so the PDF always matches the screen.
 */
function sendAnalyticsReportPdf(res, opts) {
  var business           = opts.business || null;
  var businessLogoBuffer = opts.businessLogoBuffer || null;
  var periodLabel        = opts.periodLabel;
  var summary            = opts.summary;
  var themeSummary       = opts.themeSummary || { positive: [], negative: [] };
  var summaryText        = opts.summaryText || null;
  var opportunities      = opts.opportunities || [];
  var filename            = opts.filename;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

  var doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'portrait', bufferPages: true });
  doc.pipe(res);

  var pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.y = drawBrandHeader(doc, { title: 'Analytics Report', business: business, businessLogoBuffer: businessLogoBuffer, pageWidth: pageWidth });
  doc.font('Helvetica').fontSize(9).fillColor('#999999').text(periodLabel, doc.page.margins.left, doc.y);
  doc.moveDown(0.6);

  if (summaryText) {
    drawParagraph(doc, summaryText, pageWidth);
    doc.moveDown(1);
  }

  ensureSpace(doc, 140);
  sectionTitle(doc, 'Executive Overview');
  drawKpiGrid(doc, [
    { label: 'Requests Sent',       value: summary.total_requests_sent },
    { label: 'Reviews Collected',   value: summary.total_reviews },
    { label: 'Google Reviews',      value: summary.total_public },
    { label: 'Average Rating',      value: summary.avg_rating ? summary.avg_rating.toFixed(1) + ' / 5' : '\u2014' },
    { label: 'Conversion Rate',     value: Math.round((summary.conversion_rate || 0) * 100) + '%' },
    { label: 'Avg. Time to Review', value: summary.avg_days_to_review != null ? summary.avg_days_to_review + 'd' : '\u2014' },
  ], pageWidth);
  doc.moveDown(1);

  ensureSpace(doc, 140);
  sectionTitle(doc, 'Review Request Funnel');
  var totalSent = summary.total_requests_sent || 0;
  var calcPct = function(v) { return totalSent > 0 ? Math.round(((v || 0) / totalSent) * 100) : 0; };
  drawBarRows(doc, [
    { label: 'Requests Sent',    value: totalSent,                     pct: 100,                             color: '#60A5FA' },
    { label: 'Delivered',        value: summary.total_delivered || 0,  pct: calcPct(summary.total_delivered), color: '#2DD4BF' },
    { label: 'Opened',           value: summary.total_opened || 0,     pct: calcPct(summary.total_opened),    color: '#FBBF24' },
    { label: 'Submitted',        value: summary.total_reviews || 0,    pct: calcPct(summary.total_reviews),   color: '#34D399' },
    { label: 'Posted to Google', value: summary.total_public || 0,     pct: calcPct(summary.total_public),    color: '#818CF8' },
  ], pageWidth, '#818CF8');
  doc.moveDown(1);

  ensureSpace(doc, 140);
  sectionTitle(doc, 'Rating Breakdown');
  var ratingRows = (summary.rating_breakdown || []).map(function(r) {
    return { label: r.rating + '-star', value: r.count, pct: r.pct, color: '#FBBF24' };
  });
  if (ratingRows.length > 0) {
    drawBarRows(doc, ratingRows, pageWidth, '#FBBF24');
  } else {
    doc.font('Helvetica').fontSize(9).fillColor('#999999').text('Not enough data yet.', doc.page.margins.left, doc.y);
  }
  doc.moveDown(1);

  if ((summary.by_channel_table || []).length > 0) {
    ensureSpace(doc, 120);
    sectionTitle(doc, 'Channel Performance');
    var CHANNEL_LABELS = { qr: 'QR Code', whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };
    drawChannelTable(doc, summary.by_channel_table.map(function(row) {
      return { label: CHANNEL_LABELS[row.channel] || row.channel, sent: row.sent, reviews: row.reviews, conversion_rate: row.conversion_rate };
    }), pageWidth);
    doc.moveDown(1);
  }

  if (themeSummary.positive.length > 0 || themeSummary.negative.length > 0) {
    ensureSpace(doc, 140);
    sectionTitle(doc, 'Top Feedback Topics');
    drawThemeLists(doc, themeSummary.positive, themeSummary.negative, pageWidth);
    doc.moveDown(1);
  }

  if (opportunities.length > 0) {
    ensureSpace(doc, 40 + opportunities.length * 26);
    sectionTitle(doc, 'Key Opportunities');
    drawOpportunities(doc, opportunities, pageWidth);
  }

  var pageRange = doc.bufferedPageRange();
  for (var i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
    doc.switchToPage(i);
    drawBrandFooter(doc, pageWidth);
  }

  doc.end();
}

module.exports = { buildBrandedCsv, sendBrandedPdf, sendAnalyticsReportPdf, fetchImageBuffer, BRAND_LINE };
