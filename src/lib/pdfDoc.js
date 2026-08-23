import { jsPDF } from 'jspdf';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';

// A4 at 72dpi == 595.28 x 841.89 pt, matching the design spec's 595x842px sheet.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 42;
const MARGIN_TOP = 38;
const MARGIN_BOTTOM = 38;

const INK = [15, 23, 42];
const SECONDARY = [100, 116, 139];
const LIGHT = [148, 163, 184];
const ACCENT = [255, 122, 0];
const PRIMARY = [31, 111, 235];
const DANGER = [220, 38, 38];
const PANEL = [248, 250, 252];

// Defaults if no org settings are passed in — editable via the Settings
// screen (src/screens/Settings.jsx), persisted as `orgSettings`.
const DEFAULT_COMPANY = {
  companyName: 'SIMICO SRL',
  companyAddress: "Via dell'Industria 12, 24060 Casazza (BG), Italy",
  companyVat: 'P.IVA IT04512340167',
  companyEmail: 'warehouse@simico.srl',
  warehouseLocation: 'Casazza (BG)',
  warehouseDock: 'Dock 2',
};

function legalText(companyName) {
  return (
    'The driver named above confirms having handed over / collected the parcels listed in this document, in the quantity ' +
    'stated and in the apparent condition recorded. Any damage noted was verified jointly at the moment of handover and is ' +
    `documented with photographs held by ${companyName}. Signing this document does not constitute acceptance of the goods' ` +
    'contents, which remain subject to inspection.'
  );
}

function condition(p) {
  return p.damage ? p.damage : 'Good, sealed';
}

/** Builds the handover document as a single-page jsPDF instance. */
export function buildHandoverPdf(document, org) {
  const company = { ...DEFAULT_COMPANY, ...(org || {}) };
  const doc = new jsPDF({ unit: 'pt', format: [PAGE_W, PAGE_H] });
  const contentW = PAGE_W - MARGIN_X * 2;
  let y = MARGIN_TOP;

  // Header
  doc.setFillColor(...PRIMARY);
  doc.roundedRect(MARGIN_X, y, 34, 34, 4, 4, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('S', MARGIN_X + 17, y + 23, { align: 'center' });

  doc.setTextColor(...INK);
  doc.setFontSize(14);
  doc.text(company.companyName, MARGIN_X + 44, y + 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SECONDARY);
  doc.text(company.companyAddress, MARGIN_X + 44, y + 25);
  const warehouseLine = [company.warehouseLocation, company.warehouseDock].filter(Boolean).join(' · ');
  doc.text(
    warehouseLine ? `${company.companyVat} · ${company.companyEmail} · ${warehouseLine}` : `${company.companyVat} · ${company.companyEmail}`,
    MARGIN_X + 44,
    y + 35,
  );

  const kindLabel = document.direction === 'out' ? 'OUTBOUND HANDOVER NOTE' : 'INBOUND RECEIPT NOTE';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...ACCENT);
  doc.text(kindLabel, PAGE_W - MARGIN_X, y + 4, { align: 'right' });
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(document.doc, PAGE_W - MARGIN_X, y + 18, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...SECONDARY);
  doc.text(document.docTime, PAGE_W - MARGIN_X, y + 29, { align: 'right' });

  y += 40;
  doc.setDrawColor(...INK);
  doc.setLineWidth(1.4);
  doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
  y += 16;

  // Field grid: 2 columns x 3 rows
  const rows = [
    ['Warehouse operator', document.operator],
    ['Carrier', document.carrier],
    ['Driver', document.driverName || '—'],
    ['Company', document.courierCompany || '—'],
    ['Vehicle plate', (document.plate || '—').toUpperCase()],
    ['Total parcels / boxes', `${document.parcels.length} / ${document.parcels.reduce((a, p) => a + p.boxes, 0)}`],
  ];
  const colW = contentW / 2;
  const rowH = 30;
  doc.setDrawColor(...LIGHT);
  doc.setLineWidth(0.6);
  const gridTop = y;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      const [label, value] = rows[r * 2 + c];
      const cx = MARGIN_X + c * colW;
      const cy = gridTop + r * rowH;
      doc.rect(cx, cy, colW, rowH);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(...LIGHT);
      doc.text(label.toUpperCase(), cx + 9, cy + 11);
      doc.setFontSize(10);
      doc.setTextColor(...INK);
      doc.text(String(value), cx + 9, cy + 23);
    }
  }
  y = gridTop + rowH * 3 + 16;

  // Parcel table
  const cols = [
    { key: 'n', label: '#', w: 26, align: 'left' },
    { key: 'code', label: 'Tracking ID', w: contentW - 26 - 44 - 130 - 48, align: 'left' },
    { key: 'boxes', label: 'Boxes', w: 44, align: 'center' },
    { key: 'condition', label: 'Condition', w: 130, align: 'left' },
    { key: 'time', label: 'Time', w: 48, align: 'right' },
  ];
  const tableTop = y;
  const headH = 20;
  let cx = MARGIN_X;
  doc.setFillColor(...PANEL);
  doc.rect(MARGIN_X, tableTop, contentW, headH, 'F');
  doc.setDrawColor(...LIGHT);
  doc.rect(MARGIN_X, tableTop, contentW, headH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(...SECONDARY);
  for (const col of cols) {
    const tx = col.align === 'right' ? cx + col.w - 9 : col.align === 'center' ? cx + col.w / 2 : cx + 9;
    doc.text(col.label.toUpperCase(), tx, tableTop + 13, { align: col.align });
    cx += col.w;
  }

  let ry = tableTop + headH;
  const rowHeight = 18;
  const maxRowsPerPage = Math.floor((PAGE_H - MARGIN_BOTTOM - 170 - ry) / rowHeight);
  doc.setFont('helvetica', 'normal');
  document.parcels.forEach((p, i) => {
    if (i > 0 && i % Math.max(1, maxRowsPerPage) === 0) {
      doc.addPage([PAGE_W, PAGE_H]);
      ry = MARGIN_TOP;
      doc.setFillColor(...PANEL);
      doc.rect(MARGIN_X, ry, contentW, headH, 'F');
      doc.rect(MARGIN_X, ry, contentW, headH);
      ry += headH;
    }
    cx = MARGIN_X;
    doc.setDrawColor(...LIGHT);
    doc.rect(MARGIN_X, ry, contentW, rowHeight);
    doc.setFontSize(8);
    doc.setTextColor(...LIGHT);
    doc.text(String(i + 1), cx + 9, ry + 12);
    cx += cols[0].w;
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text(String(p.code), cx + 9, ry + 12);
    cx += cols[1].w;
    doc.setFont('helvetica', 'bold');
    doc.text(String(p.boxes), cx + cols[2].w / 2, ry + 12, { align: 'center' });
    cx += cols[2].w;
    const cond = condition(p);
    doc.setFont('helvetica', p.damage ? 'bold' : 'normal');
    doc.setTextColor(...(p.damage ? DANGER : SECONDARY));
    doc.text(cond, cx + 9, ry + 12, { maxWidth: cols[3].w - 12 });
    cx += cols[3].w;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...SECONDARY);
    doc.text(String(p.time), cx + cols[4].w - 9, ry + 12, { align: 'right' });
    ry += rowHeight;
  });
  y = ry + 14;

  // Legal mention
  doc.setFillColor(...PANEL);
  const legalLines = doc.splitTextToSize(legalText(company.companyName), contentW - 22);
  const legalH = legalLines.length * 10 + 12;
  doc.rect(MARGIN_X, y, contentW, legalH, 'F');
  doc.setFillColor(...ACCENT);
  doc.rect(MARGIN_X, y, 3, legalH, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...SECONDARY);
  doc.text(legalLines, MARGIN_X + 11, y + 12);
  y += legalH + 20;

  // Signature blocks — pinned near the bottom of the last page
  const sigY = Math.max(y, PAGE_H - MARGIN_BOTTOM - 74 - 20);
  const sigColW = (contentW - 22) / 2;
  doc.setDrawColor(...INK);
  doc.setLineWidth(1);
  doc.line(MARGIN_X, sigY + 74, MARGIN_X + sigColW, sigY + 74);
  doc.line(MARGIN_X + sigColW + 22, sigY + 74, MARGIN_X + sigColW + 22 + sigColW, sigY + 74);

  doc.setFont('times', 'italic');
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text(document.operator.split(' · ')[0], MARGIN_X, sigY + 68);

  if (document.signatureDataUrl) {
    try {
      const ratio = 0.42; // approximate signature aspect ratio
      const h = 60;
      const w = Math.min(sigColW - 4, h / ratio);
      doc.addImage(document.signatureDataUrl, 'PNG', MARGIN_X + sigColW + 22, sigY + 74 - h - 2, w, h, undefined, 'FAST');
    } catch {
      /* signature couldn't be embedded — leave the box blank rather than fail the PDF */
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(...LIGHT);
  doc.text(`OPERATOR · ${document.operator.split(' · ')[0].toUpperCase()}`, MARGIN_X, sigY + 84);
  doc.text(`DRIVER · ${(document.driverName || '—').toUpperCase()}`, MARGIN_X + sigColW + 22, sigY + 84);

  // Footer
  const footY = PAGE_H - MARGIN_BOTTOM + 10;
  doc.setDrawColor(...LIGHT);
  doc.setLineWidth(0.6);
  doc.line(MARGIN_X, footY - 9, PAGE_W - MARGIN_X, footY - 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...LIGHT);
  doc.text(`${document.doc} · generated by WMS App`, MARGIN_X, footY);
  const pageCount = doc.internal.getNumberOfPages();
  doc.text(`Page 1 of ${pageCount}`, PAGE_W - MARGIN_X, footY, { align: 'right' });
  for (let p = 2; p <= pageCount; p++) {
    doc.setPage(p);
    doc.text(`Page ${p} of ${pageCount}`, PAGE_W - MARGIN_X, footY, { align: 'right' });
  }

  return doc;
}

function safeFileName(document) {
  return `${document.doc.replace(/[^A-Z0-9-]/gi, '_')}.pdf`;
}

/**
 * Writes a PDF (as a base64 data URL) to device storage and opens the
 * native share sheet — the user can print, save, or email from there
 * (Android has no single universal "print" intent outside a dedicated
 * print-service plugin, so routing every export through Share is the most
 * broadly compatible choice). Falls back to a browser download when
 * running outside the native shell (e.g. `npm run dev`).
 */
async function saveAndShare(dataUrl, filename, doc) {
  if (Capacitor.isNativePlatform()) {
    const base64 = dataUrl.split(',')[1];
    const result = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({
      title: doc.doc,
      text: `${doc.doc} — WMS App handover document`,
      url: result.uri,
    });
    return result.uri;
  }

  // Browser fallback: trigger a normal download via a Blob URL (more
  // broadly supported than navigating straight to a data: URI, and matches
  // what jsPDF's own .save() does internally).
  const blob = await (await fetch(dataUrl)).blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = window.document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  return null;
}

/** Builds and shares the handover document generated locally on-device. */
export async function exportHandoverPdf(document, org) {
  const doc = buildHandoverPdf(document, org);
  return saveAndShare(doc.output('datauristring'), safeFileName(document), document);
}

/** Shares an already-fetched PDF data URL (e.g. the ERP's archived copy) without rebuilding it. */
export async function exportPdfDataUrl(dataUrl, document) {
  return saveAndShare(dataUrl, safeFileName(document), document);
}
