// Everything this app assumes about the prep center's API lives in this one
// file: the route it calls, and the names it expects in the answer. When their
// real documentation arrives, this is the only file that has to change — the
// grouping rule (ddtGrouping.js), the document (ddtPdf.js) and the app wiring
// are all written against the normalized shape below, not against their JSON.
//
// It deliberately reuses the Prep-Center connection already configured in
// Settings › API (base URL + key) rather than introducing a second credential.
// That does mean the key sits on the phone, as it already does for every other
// call on that connection; moving it server-side would need the key in the edge
// function's environment, which is a separate decision to make once the real
// credentials exist.

import { describeError } from './api';

// The route is a placeholder until their docs land — kept here, alone, so it is
// one edit rather than a search across the app.
export const RESOLVE_PATH = '/shipments/resolve';

function withTimeout(ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(id) };
}

/** First present, non-empty value among several possible key spellings. */
function pick(obj, ...keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function addressLines(a) {
  if (!a) return [];
  if (Array.isArray(a)) return a.filter(Boolean).map(String);
  if (typeof a === 'string') return a.split('\n').map((s) => s.trim()).filter(Boolean);
  return [
    pick(a, 'name', 'company', 'companyName'),
    pick(a, 'street', 'address', 'address1', 'addressLine1'),
    pick(a, 'address2', 'addressLine2'),
    [pick(a, 'postalCode', 'zip', 'cap'), pick(a, 'city', 'town')].filter(Boolean).join(' ') || null,
    pick(a, 'province', 'state', 'region'),
    pick(a, 'country', 'countryCode'),
    pick(a, 'phone', 'telephone'),
    pick(a, 'email'),
    pick(a, 'vat', 'vatNumber') ? `VAT no.: ${pick(a, 'vat', 'vatNumber')}` : null,
  ].filter(Boolean).map(String);
}

function normalizeContents(raw) {
  return (raw || []).map((line) => ({
    description: String(pick(line, 'description', 'title', 'name', 'productName') || ''),
    sku: pick(line, 'sku', 'sellerSku', 'msku'),
    asin: pick(line, 'asin', 'ASIN'),
    qty: Number(pick(line, 'qty', 'quantity', 'units', 'count') || 0),
  }));
}

/**
 * Turn one shipment from the prep center into the shape the DDT is built from.
 *
 * The critical field is `boxes[].contents`: a DDT lists what is in the boxes
 * that actually left, and a session often ships only some of a shipment's
 * boxes. Shipment-level totals cannot answer that — if their API only returns
 * pack-group totals, `contentsPerBox` comes back false and the caller must say
 * so rather than print quantities that are quietly wrong on a legal document.
 */
export function normalizeShipment(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const boxes = pick(raw, 'boxes', 'parcels', 'packages', 'cartons') || [];
  const byTracking = new Map();
  let contentsPerBox = boxes.length > 0;
  for (const b of boxes) {
    const tracking = pick(b, 'tracking', 'trackingId', 'trackingNumber', 'carrierTracking');
    if (!tracking) continue;
    const contents = pick(b, 'contents', 'items', 'lines', 'products');
    if (!contents) contentsPerBox = false;
    byTracking.set(String(tracking), {
      weightKg: (() => {
        const w = pick(b, 'weightKg', 'weight', 'weight_kg', 'grossWeight');
        const n = Number(w);
        return w === null || !Number.isFinite(n) ? null : n;
      })(),
      contents: normalizeContents(contents),
    });
  }

  return {
    shipmentId: String(pick(raw, 'shipmentId', 'shipment_id', 'id', 'shippingId') || ''),
    fbaId: pick(raw, 'fbaId', 'fba_id', 'inboundPlanId', 'amazonShipmentId'),
    amazonReference: pick(raw, 'amazonReference', 'referenceId', 'amazonReferenceNumber'),
    pickup: addressLines(pick(raw, 'pickup', 'pickupAddress', 'sender', 'shipFrom')),
    customer: addressLines(pick(raw, 'customer', 'customerAddress', 'billTo', 'client')),
    destination: addressLines(pick(raw, 'destination', 'destinationAddress', 'shipTo', 'fulfillmentCenter')),
    carrier: pick(raw, 'carrier', 'carrierName', 'transportationMethod'),
    reason: pick(raw, 'reason', 'transportationReason', 'causale'),
    goodsDescription: pick(raw, 'goodsDescription', 'descriptionOfGoods', 'aspetto') || 'Box',
    prepAt: pick(raw, 'prepAt', 'preparedAt', 'packedAt'),
    packingGroup: pick(raw, 'packingGroup', 'packGroup', 'groupName'),
    legalNote: pick(raw, 'legalNote', 'notes', 'footerNote'),
    byTracking,
    contentsPerBox,
  };
}

/**
 * Resolve scanned tracking IDs to their shipments.
 * Returns { ok, shipments: Map<tracking, normalizedShipment>, unknown: [], error }.
 * A failure is never fatal: scanning has to keep working with no network, so
 * the caller records the parcel and resolves it later at sync time.
 */
export async function resolveTrackings(config, trackings, options = {}) {
  const list = [...new Set((trackings || []).filter(Boolean).map(String))];
  if (!list.length) return { ok: true, shipments: new Map(), unknown: [] };
  const base = (config?.baseUrl || '').replace(/\/+$/, '');
  if (!base) return { ok: false, shipments: new Map(), unknown: list, error: 'Prep-Center not configured' };

  const { signal, cancel } = withTimeout(options.timeoutMs || 15000);
  try {
    const res = await fetch(base + RESOLVE_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ trackings: list }),
      signal,
    });
    cancel();
    const text = await res.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      return { ok: false, shipments: new Map(), unknown: list, error: describeError({ status: res.status, data }) };
    }

    const shipments = new Map();
    const raw = (Array.isArray(data) ? data : pick(data || {}, 'shipments', 'results', 'data')) || [];
    for (const item of raw) {
      const s = normalizeShipment(item);
      if (!s || !s.shipmentId) continue;
      for (const tracking of s.byTracking.keys()) shipments.set(tracking, s);
    }
    const unknown = list.filter((t) => !shipments.has(t));
    return { ok: true, shipments, unknown };
  } catch (err) {
    cancel();
    return {
      ok: false,
      shipments: new Map(),
      unknown: list,
      error: err?.name === 'AbortError' ? 'Request timed out' : String(err?.message || err),
    };
  }
}
