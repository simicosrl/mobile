// Receptions ("inbound" orders clients announce) as the Prep-Center stores
// them, read with the operator's own Prep-Center session — the same tables and
// the same search function its admin "Receiving" page uses, so the app sees
// exactly what the office sees and nothing on the Prep-Center side changes.
//
// This file only reads. Recording received units is a later stage and will
// live next to these, mirroring AdminReceiving.jsx's applyReceivedUnits.

import { prepFetch } from './prepAuth';

const STOCK_ITEM_COLUMNS = 'id,asin,name,sku,fnsku,ean,internal_code,image_url';

/** Uppercase, no spaces — how the Prep-Center compares tracking IDs. */
export function normalizeTracking(code) {
  return String(code || '').replace(/\s+/g, '').toUpperCase();
}

/** Every tracking ID a reception carries, normalized, without duplicates. */
export function receptionTrackings(row) {
  const list = [row?.tracking_id, ...(Array.isArray(row?.tracking_ids) ? row.tracking_ids : [])]
    .map(normalizeTracking)
    .filter(Boolean);
  return [...new Set(list)];
}

export function clientLabel(row) {
  return (
    row?.company_name || row?.companies?.name || row?.client_name || row?.store_name ||
    row?.user_email || row?.client?.email || 'Client'
  );
}

// The admin page's own search (search_admin_receiving_shipments_v2): country
// scope, the "active" rule (still to receive or partially received, computed
// from the lines rather than the stored status) and tracking/name/SKU search.
async function searchReceptions(token, { country, search = null, field = 'quick', includeArchive = false, pageSize = 50 }) {
  const res = await prepFetch('/rest/v1/rpc/search_admin_receiving_shipments_v2', {
    method: 'POST',
    token,
    body: {
      p_warehouse_country: country,
      p_include_archive: includeArchive,
      p_status: 'all',
      p_search: search,
      p_search_field: field,
      p_page: 1,
      p_page_size: pageSize,
      p_company_id: null,
      p_hide_untracked_amazon_removals: false,
    },
  });
  if (!res.ok) return { ok: false, status: res.status, reason: res.status === 0 ? 'offline' : 'failed' };
  return { ok: true, status: res.status, rows: Array.isArray(res.data) ? res.data : [] };
}

/** Receptions still to receive or partially received, newest first. */
export function listOpenReceptions(token, country) {
  return searchReceptions(token, { country });
}

/** Free search (client, email, tracking, SKU, product…), received ones included. */
export function searchAllReceptions(token, country, text) {
  return searchReceptions(token, { country, search: text, includeArchive: true });
}

/**
 * Receptions for a scanned parcel. Exact tracking matches win; the search
 * itself is a "contains", so when nothing matches exactly the near matches
 * are returned flagged `exact: false` for the operator to judge.
 * Received receptions are included: a late parcel of a closed reception
 * still has to be found.
 */
export async function findByTracking(token, country, code) {
  const wanted = normalizeTracking(code);
  if (!wanted) return { ok: true, rows: [], exact: true };
  const res = await searchReceptions(token, { country, search: wanted, field: 'tracking', includeArchive: true, pageSize: 20 });
  if (!res.ok) return res;
  const exact = res.rows.filter((r) => receptionTrackings(r).includes(wanted));
  return { ok: true, status: res.status, rows: exact.length ? exact : res.rows, exact: exact.length > 0 || !res.rows.length };
}

/**
 * The receptions behind a whole courier handover: every scanned parcel looked
 * up exactly (no near matches here — a list of guesses for 30 parcels helps
 * nobody). { ok, rows: [{ ...reception, matched: [tracking] }], unmatched: [tracking] }.
 */
export async function findByTrackings(token, country, codes) {
  const wanted = [...new Set((codes || []).map(normalizeTracking).filter(Boolean))];
  const byId = new Map();
  const unmatched = [];
  for (const code of wanted) {
    const res = await findByTracking(token, country, code);
    if (!res.ok) return res;
    const exact = res.exact ? res.rows.filter((r) => receptionTrackings(r).includes(code)) : [];
    if (!exact.length) { unmatched.push(code); continue; }
    for (const r of exact) {
      const prev = byId.get(r.id);
      byId.set(r.id, { ...r, matched: [...(prev?.matched || []), code] });
    }
  }
  return { ok: true, rows: [...byId.values()], unmatched };
}

const ASIN_RE = /^[A-Z0-9]{10}$/;
const looksLikeAsin = (v) => ASIN_RE.test(v) && /[A-Z]/.test(v);

function lineFromItem(item) {
  const stock = item.stock_item || {};
  const eanAsin = String(item.ean_asin || '').trim().toUpperCase();
  const expected = Math.max(0, Number(item.quantity_received || 0));
  const received = Math.max(0, Number(item.received_units || 0));
  return {
    id: item.id,
    lineNumber: Number(item.line_number || 0),
    name: item.product_name || stock.name || 'Product',
    image: stock.image_url || null,
    ean: stock.ean || (/^\d{8,14}$/.test(eanAsin) ? eanAsin : null),
    asin: stock.asin || (looksLikeAsin(eanAsin) ? eanAsin : null),
    fnsku: item.fnsku || stock.fnsku || null,
    sku: item.sku || stock.sku || null,
    internalCode: stock.internal_code || null,
    eanAsin: eanAsin || null,
    expected,
    received,
    sendToFba: !!item.send_to_fba,
    fbaQty: Number(item.fba_qty || 0),
    stockItemId: item.stock_item_id || stock.id || null,
    notes: [],
    shelves: [], // [{ code, qty }] where this line's units are now
  };
}

/** Same rule as the admin list: computed from the lines, not the stored status. */
export function computeStatus(storedStatus, lines) {
  const base = String(storedStatus || 'submitted').toLowerCase();
  if (base === 'cancelled') return base;
  if (!lines.length) return base === 'draft' ? 'submitted' : base;
  const all = lines.every((l) => l.expected <= 0 || l.received >= l.expected);
  const any = lines.some((l) => l.received > 0);
  if (all && any) return 'received';
  if (any) return 'partial';
  return 'submitted';
}

/**
 * One reception with its lines, product details, the client and every note
 * the client or the office left on it. Notes attached to a line (line_id)
 * are shown on that product; the rest on the reception.
 */
export async function loadReception(token, id) {
  const shipmentRes = await prepFetch(
    `/rest/v1/receiving_shipments?id=eq.${encodeURIComponent(id)}` +
      `&select=*,companies:companies(name),receiving_shipment_items(id),receiving_items(*,stock_item:stock_items(${STOCK_ITEM_COLUMNS}))`,
    { token },
  );
  if (!shipmentRes.ok) return { ok: false, status: shipmentRes.status, reason: shipmentRes.status === 0 ? 'offline' : 'failed' };
  const row = Array.isArray(shipmentRes.data) ? shipmentRes.data[0] : null;
  if (!row) return { ok: false, status: 404, reason: 'notFound' };

  const [clientRes, notesRes, shelvesRes] = await Promise.all([
    row.user_id
      ? prepFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}&select=first_name,last_name,company_name,store_name,email,phone`, { token })
      : Promise.resolve({ ok: true, data: [] }),
    prepFetch(
      `/rest/v1/receiving_shipment_notes?receiving_shipment_id=eq.${encodeURIComponent(id)}` +
        '&select=id,sender_type,body,kind,line_id,created_at&order=created_at.asc',
      { token },
    ),
    // Where this reception's units are now (utils/receivingPlacements.js).
    prepFetch(
      `/rest/v1/warehouse_locations?origin_ref_type=eq.receiving_shipment&origin_ref_id=eq.${encodeURIComponent(id)}` +
        '&quantity=gt.0&select=quantity,sku,asin,origin_ref_item_id,storage_place:storage_places(code)',
      { token },
    ),
  ]);
  const client = (clientRes.ok && Array.isArray(clientRes.data) && clientRes.data[0]) || null;
  const thread = notesRes.ok && Array.isArray(notesRes.data) ? notesRes.data : [];

  const lines = (row.receiving_items || [])
    .map(lineFromItem)
    .sort((a, b) => a.lineNumber - b.lineNumber);
  const byId = new Map(lines.map((l) => [l.id, l]));
  const generalNotes = [];
  for (const n of thread) {
    const note = { id: n.id, from: n.sender_type, kind: n.kind, body: n.body, at: n.created_at };
    const line = n.line_id && byId.get(n.line_id);
    if (line) line.notes.push(note);
    else generalNotes.push(note);
  }
  // Units on shelves, per line: by line id, else by the product's SKU/ASIN
  // as the website matches older rows.
  const norm = (v) => String(v || '').toLowerCase().trim();
  const items = row.receiving_items || [];
  for (const loc of (shelvesRes.ok && Array.isArray(shelvesRes.data) ? shelvesRes.data : [])) {
    let line = loc.origin_ref_item_id ? byId.get(loc.origin_ref_item_id) : null;
    if (!line && !loc.origin_ref_item_id) {
      const it = items.find((i) =>
        norm(i.sku || i.stock_item?.sku) === norm(loc.sku) &&
        norm(i.asin || i.stock_item?.asin || i.ean_asin) === norm(loc.asin));
      line = it ? byId.get(it.id) : null;
    }
    if (!line) continue;
    const code = loc.storage_place?.code || '?';
    const hit = line.shelves.find((x) => x.code === code);
    if (hit) hit.qty += Number(loc.quantity || 0);
    else line.shelves.push({ code, qty: Number(loc.quantity || 0) });
  }

  // The intake note (receiving_shipments.notes) was copied into the thread
  // when the thread was introduced; show it only when it says something the
  // thread does not already.
  const intake = String(row.notes || '').trim();
  const intakeNote = intake && !generalNotes.some((n) => String(n.body || '').trim() === intake) ? intake : null;

  const clientName = client
    ? [client.first_name, client.last_name].filter(Boolean).join(' ').trim()
    : '';
  return {
    ok: true,
    reception: {
      id: row.id,
      storedStatus: row.status,
      status: computeStatus(row.status, lines),
      createdAt: row.created_at,
      receivedAt: row.received_at,
      warehouseCountry: row.warehouse_country,
      clientId: row.user_id || null,
      carrier: row.carrier === 'other' ? row.carrier_other || 'Other' : row.carrier || null,
      trackings: receptionTrackings(row),
      importSource: String(row.import_source || '').toLowerCase() || null,
      fbaMode: row.fba_mode || null,
      company: client?.company_name || row.companies?.name || client?.store_name || null,
      clientName: clientName || null,
      clientEmail: client?.email || null,
      intakeNote,
      notes: generalNotes,
      lines,
      // Older receptions kept their lines in receiving_shipment_items; the app
      // only works with the current table and says so instead of showing none.
      hasLegacyLinesOnly: lines.length === 0 && Array.isArray(row.receiving_shipment_items) && row.receiving_shipment_items.length > 0,
    },
  };
}

// --- matching a scanned product code to a line ---

function codeKey(v) {
  const s = String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  // UPC-A (12) and EAN-13 (13) are the same number with a leading zero;
  // GTIN-14 adds another. Compare digits without leading zeros.
  return /^\d+$/.test(s) ? s.replace(/^0+/, '') : s;
}

/** Lines whose EAN, FNSKU, ASIN, SKU or internal code is the scanned code. */
export function matchLines(lines, code) {
  const key = codeKey(code);
  if (!key) return [];
  return lines.filter((l) =>
    [l.ean, l.eanAsin, l.asin, l.fnsku, l.sku, l.internalCode].some((v) => v && codeKey(v) === key),
  );
}
