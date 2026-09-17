import { jsPDF } from 'jspdf';
import { productLines, boxCount, totalWeightKg } from './ddtGrouping';

// The DDT (delivery note) that travels with an outbound shipment, rebuilt to
// match the prep center's own layout field for field — header, the three
// address boxes, products and services, transportation data, additional
// information — with one thing their version does not have: a driver signature
// block at the foot of the page, which is the reason we generate it here.
//
// Deliberately a separate builder from pdfDoc.js's buildHandoverPdf: that one is
// the internal handover record and has its own layout. They share jsPDF and the
// same page geometry, nothing else.

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 42;

// Where content must stop so it never runs into the footer, and where it
// resumes on a continuation page.
const FOOTER_Y = PAGE_H - 28;
const CONTENT_BOTTOM = FOOTER_Y - 14;
const PAGE_TOP = 64;

const INK = [15, 23, 42];
const SECONDARY = [100, 116, 139];
const LINE = [203, 213, 225];
const PANEL = [248, 250, 252];

function box(doc, x, y, w, h) {
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.6);
  doc.rect(x, y, w, h);
}

function label(doc, text, x, y, size = 7.5) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(size);
  doc.setTextColor(...INK);
  doc.text(text, x, y);
}

function value(doc, text, x, y, size = 8.5, bold = false) {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...INK);
  doc.text(text, x, y);
}

function sectionTitle(doc, text, y) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text(text, PAGE_W / 2, y, { align: 'center' });
}

// Start a new page if `need` points of vertical space are not left. Every
// section that must not be split calls this before it draws; without it a long
// products table simply kept drawing over the footer and off the sheet.
function ensureSpace(doc, y, need) {
  if (y + need <= CONTENT_BOTTOM) return y;
  doc.addPage();
  return PAGE_TOP;
}

function addressBlock(doc, heading, lines, x, y, w, h) {
  box(doc, x, y, w, h);
  doc.setFillColor(...PANEL);
  doc.rect(x, y, w, 20, 'F');
  box(doc, x, y, w, 20);
  label(doc, heading, x + 9, y + 13.5);
  let ly = y + 32;
  lines.filter(Boolean).forEach((line, i) => {
    value(doc, String(line), x + 9, ly, 8.5, i === 0);
    ly += 12.5;
  });
}

/**
 * @param ddt   one group from groupForDdt(), plus the shipment-level fields the
 *              prep center returns (addresses, references, carrier, reason...)
 * @param org   our own company details (Settings screen)
 */
export function buildDdtPdf(ddt, org = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });

  // --- header -------------------------------------------------------------
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...INK);
  doc.text('DELIVERY NOTE', PAGE_W - MARGIN_X, 62, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`no. ${ddt.number} del ${ddt.date}`, PAGE_W - MARGIN_X, 78, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...INK);
  doc.text(org.companyName || 'SIMICO', MARGIN_X, 70);

  // --- three address boxes ------------------------------------------------
  const boxTop = 94;
  // Height follows the longest of the three addresses. A fixed height either
  // wastes the page or, worse, cuts the last line off — and the last line of a
  // pick-up address is exactly the kind of thing (email, VAT) that must be there.
  const addrRows = Math.max(
    1,
    ...[ddt.pickup, ddt.customer, ddt.destination].map((l) => (l || []).filter(Boolean).length)
  );
  const boxH = 40 + (addrRows - 1) * 12.5;
  const gap = 8;
  const colW = (PAGE_W - MARGIN_X * 2 - gap * 2) / 3;
  addressBlock(doc, 'PICK-UP ADDRESS', ddt.pickup || [], MARGIN_X, boxTop, colW, boxH);
  addressBlock(doc, 'CUSTOMER', ddt.customer || [], MARGIN_X + colW + gap, boxTop, colW, boxH);
  addressBlock(doc, 'MERCHANDISE DESTINATION', ddt.destination || [], MARGIN_X + (colW + gap) * 2, boxTop, colW, boxH);

  // --- products and services ---------------------------------------------
  let y = boxTop + boxH + 20;
  sectionTitle(doc, 'PRODUCTS AND SERVICES', y);
  y += 12;

  const noW = 34;
  const qtyW = 44;
  const descW = PAGE_W - MARGIN_X * 2 - noW - qtyW;
  const productsHeader = (ty) => {
    doc.setFillColor(...PANEL);
    doc.rect(MARGIN_X, ty, PAGE_W - MARGIN_X * 2, 22, 'F');
    box(doc, MARGIN_X, ty, PAGE_W - MARGIN_X * 2, 22);
    label(doc, 'NO', MARGIN_X + 9, ty + 14.5);
    label(doc, 'DESCRIPTION', MARGIN_X + noW + 9, ty + 14.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('QTY', PAGE_W - MARGIN_X - 9, ty + 14.5, { align: 'right' });
    return ty + 22;
  };
  y = productsHeader(y);

  const lines = productLines(ddt);
  if (!lines.length) {
    // No itemised contents: the prep center's API does not expose what is in a
    // box, so the document describes the consignment rather than inventing a
    // product list. The transportation table below still carries the box count,
    // the weight and the goods description, which is what a delivery note has
    // to state; itemised lines appear here automatically once that data exists.
    const rowH = 30;
    box(doc, MARGIN_X, y, PAGE_W - MARGIN_X * 2, rowH);
    value(doc, '1', MARGIN_X + 9, y + 19);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    const n = boxCount(ddt);
    doc.text(`${ddt.goodsDescription || 'Box'} — ${n} package${n === 1 ? '' : 's'}, as listed under DOCUMENT REFERENCE`,
      MARGIN_X + noW + 9, y + 19);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(String(n), PAGE_W - MARGIN_X - 9, y + 19, { align: 'right' });
    y += rowH;
  }
  lines.forEach((item, i) => {
    const desc = doc.splitTextToSize(String(item.description || ''), descW - 18);
    const ref = [item.sku ? `SKU: ${item.sku}` : null, item.asin ? `ASIN: ${item.asin}` : null]
      .filter(Boolean)
      .join(' · ');
    // The reference line has to be measured with the same line height it is
    // drawn at, or a long description pushes it onto the row's bottom border.
    const DESC_LH = 10.5;
    const rowH = Math.max(26, desc.length * DESC_LH + (ref ? DESC_LH : 0) + 11);
    // A row is never split; it moves whole to the next page, which repeats the
    // column header so the continuation is still readable as a table.
    if (y + rowH > CONTENT_BOTTOM) {
      doc.addPage();
      y = productsHeader(PAGE_TOP);
    }
    box(doc, MARGIN_X, y, PAGE_W - MARGIN_X * 2, rowH);
    value(doc, String(i + 1), MARGIN_X + 9, y + 15);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    doc.text(desc, MARGIN_X + noW + 9, y + 15);
    if (ref) {
      doc.setFontSize(7.5);
      doc.setTextColor(...SECONDARY);
      doc.text(ref, MARGIN_X + noW + 9, y + 15 + desc.length * DESC_LH);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(String(item.qty), PAGE_W - MARGIN_X - 9, y + 15, { align: 'right' });
    y += rowH;
  });

  // --- transportation data ------------------------------------------------
  y += 14;
  const cols = [
    { head: ['TRANSPORTATION', 'METHOD'], w: 74, v: ddt.carrier || '—' },
    { head: ['TRANSPORTATION REASON'], w: 130, v: ddt.reason || '—' },
    { head: ['BOX', 'NR.'], w: 40, v: String(boxCount(ddt)) },
    { head: ['DESCRIPTION', 'OF GOODS'], w: 84, v: ddt.goodsDescription || 'Box' },
    { head: ['WEIGHT'], w: 62, v: totalWeightKg(ddt) === null ? '—' : `${totalWeightKg(ddt).toFixed(2)} kg` },
    { head: ['DATE TIME OF', 'COLLECTION'], w: 0, v: ddt.collectionAt || '—' },
    { head: ['DATE TIME', 'OF PREP'], w: 0, v: ddt.prepAt || '—' },
  ];
  const fixed = cols.reduce((a, c) => a + c.w, 0);
  const flexW = (PAGE_W - MARGIN_X * 2 - fixed) / 2;
  cols.forEach((c) => { if (!c.w) c.w = flexW; });

  const headH = 26;
  // Measure with the font the cells are actually drawn in. splitTextToSize uses
  // whatever font is current, so measuring under a leftover heading font wrapped
  // "16/09/2026" onto two lines on continuation pages and not on the first.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const bodyLinesProbe = cols.map((c) => doc.splitTextToSize(String(c.v), c.w - 10));
  const bodyHProbe = Math.max(26, Math.max(...bodyLinesProbe.map((l) => l.length)) * 10 + 12);
  y = ensureSpace(doc, y, 12 + headH + bodyHProbe);
  sectionTitle(doc, 'TRANSPORTATION DATA', y);
  y += 12;

  doc.setFillColor(...PANEL);
  doc.rect(MARGIN_X, y, PAGE_W - MARGIN_X * 2, headH, 'F');
  let cx = MARGIN_X;
  cols.forEach((c) => {
    box(doc, cx, y, c.w, headH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(...INK);
    c.head.forEach((h, i) => doc.text(h, cx + c.w / 2, y + 11 + i * 9, { align: 'center' }));
    cx += c.w;
  });
  y += headH;

  const bodyLines = bodyLinesProbe;
  const bodyH = bodyHProbe;
  cx = MARGIN_X;
  cols.forEach((c, i) => {
    box(doc, cx, y, c.w, bodyH);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text(bodyLines[i], cx + c.w / 2, y + 15, { align: 'center' });
    cx += c.w;
  });
  y += bodyH;

  // --- additional information --------------------------------------------
  y += 14;
  const refs = ddt.references || [];
  const legal = doc.splitTextToSize(String(ddt.legalNote || ''), PAGE_W - MARGIN_X * 2 - 22);
  const confirm = ddt.confirmationLine ? doc.splitTextToSize(String(ddt.confirmationLine), PAGE_W - MARGIN_X * 2 - 22) : [];
  const infoH = 26 + refs.length * 13 + 6 + legal.length * 10.5 + (confirm.length ? 8 + confirm.length * 10.5 : 0) + 8;
  y = ensureSpace(doc, y, 12 + infoH);
  sectionTitle(doc, 'ADDITIONAL INFORMATION', y);
  y += 12;

  box(doc, MARGIN_X, y, PAGE_W - MARGIN_X * 2, infoH);
  label(doc, 'DOCUMENT REFERENCE', MARGIN_X + 11, y + 18, 8);
  let iy = y + 32;
  refs.forEach((r, i) => {
    value(doc, `${i + 1}: ${r}`, MARGIN_X + 11, iy);
    iy += 13;
  });
  iy += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(...SECONDARY);
  doc.text(legal, MARGIN_X + 11, iy);
  iy += legal.length * 10.5;
  if (confirm.length) {
    iy += 8;
    doc.setTextColor(...INK);
    doc.text(confirm, MARGIN_X + 11, iy);
  }
  y += infoH;

  // --- driver signature ---------------------------------------------------
  // The reason this document is generated here rather than printed from the
  // prep center: the driver signs it at handover, on the spot. It sits in the
  // space their layout leaves free at the foot of the page, and is pinned to
  // the bottom so it lands in the same place whatever the products table does.
  const sigH = 82;
  const sigColW = (PAGE_W - MARGIN_X * 2 - 20) / 2;

  // Never let the signature run off the sheet. A long products table is the
  // ordinary reason it would, and a clipped signature block on a document that
  // exists precisely to be signed is not a cosmetic problem — so it moves to a
  // second page rather than being cut.
  let sigY;
  if (y + 20 + 12 + sigH > CONTENT_BOTTOM + 2) {
    doc.addPage();
    sigY = 92;
  } else {
    sigY = Math.max(y + 20 + 12, CONTENT_BOTTOM + 2 - sigH);
  }

  sectionTitle(doc, 'DRIVER SIGNATURE', sigY - 12);

  box(doc, MARGIN_X, sigY, sigColW, sigH);
  label(doc, 'DRIVER', MARGIN_X + 11, sigY + 15, 7.5);
  value(doc, (ddt.driverName || '—').toUpperCase(), MARGIN_X + 11, sigY + 33, 10, true);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SECONDARY);
  doc.text(ddt.driverCompany || '—', MARGIN_X + 11, sigY + 48);
  doc.text(`Plate: ${ddt.driverPlate || '—'}`, MARGIN_X + 11, sigY + 61);
  doc.text(`Collected: ${ddt.signedAt || '—'}`, MARGIN_X + 11, sigY + 74);

  const sx = MARGIN_X + sigColW + 20;
  const rule = sigY + sigH - 16;
  box(doc, sx, sigY, sigColW, sigH);
  label(doc, 'SIGNATURE', sx + 11, sigY + 15, 7.5);
  if (ddt.signatureDataUrl) {
    try {
      // Fit the ink between the label and the rule, by both dimensions. Scaling
      // on width alone made a tall signature overrun upwards and paint straight
      // over the word SIGNATURE.
      const availW = sigColW - 40;
      const availH = rule - (sigY + 20) - 2;
      let ratio = 0.34;
      try {
        const props = doc.getImageProperties(ddt.signatureDataUrl);
        if (props?.width && props?.height) ratio = props.height / props.width;
      } catch {
        /* keep the default ratio if the image can't be probed */
      }
      let w = availW;
      let h = w * ratio;
      if (h > availH) { h = availH; w = h / ratio; }
      doc.addImage(ddt.signatureDataUrl, 'PNG', sx + (sigColW - w) / 2, rule - 2 - h, w, h, undefined, 'FAST');
    } catch {
      /* a signature that can't be embedded must not take the document down */
    }
  }
  doc.setDrawColor(...LINE);
  doc.line(sx + 20, rule, sx + sigColW - 20, rule);

  // --- footer -------------------------------------------------------------
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...SECONDARY);
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...SECONDARY);
    doc.text(`${ddt.number} · generated by WMS App`, MARGIN_X, PAGE_H - 28);
    doc.text(`Page ${i} of ${pages}`, PAGE_W - MARGIN_X, PAGE_H - 28, { align: 'right' });
  }

  return doc;
}

export function ddtDataUrl(ddt, org) {
  return buildDdtPdf(ddt, org).output('datauristring');
}
