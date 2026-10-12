// Stock check and shelf moves on the Prep-Center — what is on a shelf, whose a
// product is and where it sits, and moving it between shelves. Same tables and
// the same functions as the website's Warehouse page (AdminWarehouse.jsx,
// config/supabase.js listWarehouseLocations / relocateWarehouseProduct /
// unassignWarehouseProduct), with the operator's own session. Nothing on the
// Prep-Center side changes.
//
// One product can belong to several clients (each has its own stock_items row,
// often with the same EAN). Everything here is therefore keyed by the stock
// item — one client's product — never by the barcode alone, and a shelf row is
// tied to its owner through warehouse_locations.stock_item_id.

import { prepFetch } from './prepAuth';
import { readShelf, readClaim, shelfAvailability } from './prepReceivingSave';

const STOCK_COLUMNS = 'id,name,image_url,ean,asin,sku,fnsku,internal_code,qty,prep_qty_by_country,company_id,user_id';
const PROFILE_COLUMNS = 'id,company_id,company_name,store_name,first_name,last_name,email';
const OPEN_RECEPTION = new Set(['draft', 'submitted', 'partial']);

const opKey = (prefix) => `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

async function get(token, path) {
  const res = await prepFetch(path, { token });
  if (!res.ok) {
    const err = new Error(res.data?.message || res.data?.error || `HTTP ${res.status}`);
    err.reason = res.status === 0 ? 'offline' : res.status === 401 ? 'unauthorized' : 'failed';
    err.status = res.status;
    throw err;
  }
  return Array.isArray(res.data) ? res.data : [];
}
const fail = (err) => ({ ok: false, reason: err.reason || 'failed', message: err.message, status: err.status });
const inList = (vals) => `(${[...new Set(vals)].map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(',')})`;

/**
 * The country's stock exactly as the client's stock page shows it
 * (utils/marketStock.js getPrepQtyForMarket): prep_qty_by_country[country],
 * 0 when the item has nothing recorded for that country. Not `qty`: that is
 * the total over all countries, and a client often has one listing per
 * marketplace (AMZFR_…, AMZIT_…) for the same product — counting a French
 * listing's total as Italian stock showed the same units twice.
 */
export function stockForCountry(item, country) {
  const map = item?.prep_qty_by_country;
  if (map && typeof map === 'object' && !Array.isArray(map) && Object.prototype.hasOwnProperty.call(map, country)) {
    const n = Number(map[country] || 0);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function clientName(company, profile) {
  return company?.name || profile?.company_name || profile?.store_name ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.email || 'Unknown client';
}

async function countryWarehouseIds(token, country) {
  return (await get(token, `/rest/v1/warehouses?country=eq.${encodeURIComponent(country)}&select=id`)).map((w) => w.id);
}

// Barcode spellings worth asking for: as scanned, upper-case, and the
// EAN/UPC forms that differ only by leading zeros.
function codeVariants(code) {
  const raw = String(code || '').trim();
  const up = raw.toUpperCase();
  const out = new Set([raw, up]);
  if (/^\d+$/.test(raw)) {
    const bare = raw.replace(/^0+/, '');
    for (let len = Math.max(bare.length, 8); len <= 14; len += 1) out.add(bare.padStart(len, '0'));
    out.add(bare);
  }
  return [...out].filter(Boolean);
}

async function namesFor(token, companyIds, profileIds) {
  const [companies, profiles] = await Promise.all([
    companyIds.length ? get(token, `/rest/v1/companies?id=in.${inList(companyIds)}&select=id,name`) : [],
    profileIds.length ? get(token, `/rest/v1/profiles?id=in.${inList(profileIds)}&select=${PROFILE_COLUMNS}`) : [],
  ]);
  return {
    company: new Map(companies.map((c) => [c.id, c])),
    profile: new Map(profiles.map((p) => [p.id, p])),
  };
}

function locationRow(l) {
  return {
    id: l.id,
    placeId: l.storage_place_id,
    code: l.storage_place?.code || '?',
    placeActive: l.storage_place?.active !== false && l.storage_place?.blocked !== true,
    warehouseId: l.warehouse_id,
    clientId: l.client_id,
    stockItemId: l.stock_item_id || null,
    qty: Number(l.quantity || 0),
    lot: l.lot_code || null,
    expiry: l.expiration_date || null,
    title: l.product_title || null,
    sku: l.sku || null,
    asin: l.asin || null,
  };
}

/**
 * A scanned product code → one card per client who owns it:
 * { ok, owners: [{ key, client, item, stock, onShelves, notOnShelf, locations, expected }] }.
 * `expected` lists open receptions in this country still waiting for it.
 * Receptions for the code whose product has no stock item yet get their own
 * card (item null), so goods on their way are never hidden.
 */
export async function lookupProduct(token, { code, stockItemId = null, country }) {
  try {
    const variants = codeVariants(code);
    const items = stockItemId
      ? await get(token, `/rest/v1/stock_items?id=eq.${encodeURIComponent(stockItemId)}&select=${STOCK_COLUMNS}`)
      : await get(token, `/rest/v1/stock_items?or=(${['ean', 'asin', 'sku', 'fnsku', 'internal_code']
        .map((col) => `${col}.in.${inList(variants)}`).join(',')})&select=${STOCK_COLUMNS}&limit=50`);
    const ids = items.map((i) => i.id);
    const whIds = await countryWarehouseIds(token, country);

    // Reception lines with no stock item link, matched by code instead (older
    // receptions, or lines the Prep-Center never linked).
    const itemCodes = [...new Set(items.flatMap((i) => [i.sku, i.fnsku, i.ean, i.asin]).filter(Boolean).map(String))];
    const [locs, pendingById, pendingByCode, receivedRows, unlinkedRows] = await Promise.all([
      ids.length && whIds.length
        ? get(token, `/rest/v1/warehouse_locations?stock_item_id=in.(${ids.join(',')})&warehouse_id=in.(${whIds.join(',')})` +
          '&quantity=gt.0&select=*,storage_place:storage_places(*)&order=quantity.desc')
        : [],
      ids.length
        ? get(token, `/rest/v1/receiving_items?stock_item_id=in.(${ids.join(',')})` +
          '&select=id,stock_item_id,quantity_received,received_units,shipment:receiving_shipments(id,status,warehouse_country,tracking_id,created_at,company_id,user_id)')
        : [],
      stockItemId ? [] : get(token, `/rest/v1/receiving_items?stock_item_id=is.null&ean_asin=in.${inList(variants)}` +
        '&select=id,product_name,quantity_received,received_units,shipment:receiving_shipments(id,status,warehouse_country,tracking_id,created_at,company_id,user_id)&limit=50'),
      // Receptions these units came in through — the only way the website
      // puts stock on a shelf without adding stock (AdminReceiving placement).
      ids.length
        ? get(token, `/rest/v1/receiving_items?stock_item_id=in.(${ids.join(',')})&received_units=gt.0` +
          '&select=id,stock_item_id,received_units,quantity_received,is_received,product_name,sku,shipment:receiving_shipments(id,warehouse_country,user_id,company_id,created_at)&limit=200')
        : [],
      itemCodes.length
        ? get(token, `/rest/v1/receiving_items?stock_item_id=is.null&received_units=gt.0` +
          `&or=(sku.in.${inList(itemCodes)},fnsku.in.${inList(itemCodes)},ean_asin.in.${inList(itemCodes)})` +
          '&select=id,stock_item_id,received_units,quantity_received,is_received,product_name,sku,fnsku,ean_asin,shipment:receiving_shipments(id,warehouse_country,user_id,company_id,created_at)&limit=200')
        : [],
    ]);
    // An unlinked line belongs to an item of the same client with a matching
    // code (SKU / FNSKU first: they are per listing; EAN/ASIN only when the
    // client has a single listing for it).
    const norm = (v) => String(v || '').trim().toUpperCase();
    for (const r of unlinkedRows) {
      const mine = items.filter((i) => i.company_id && i.company_id === r.shipment?.company_id);
      const byListing = mine.filter((i) => (r.sku && norm(i.sku) === norm(r.sku)) || (r.fnsku && norm(i.fnsku) === norm(r.fnsku)));
      const byProduct = mine.filter((i) => r.ean_asin && (norm(i.ean) === norm(r.ean_asin) || norm(i.asin) === norm(r.ean_asin)));
      const owner = byListing.length === 1 ? byListing[0] : byListing.length === 0 && byProduct.length === 1 ? byProduct[0] : null;
      if (owner) receivedRows.push({ ...r, stock_item_id: owner.id });
    }
    const sourcesHere = receivedRows.filter((r) => r.shipment && r.shipment.warehouse_country === country);
    const placedByOrigin = new Map();
    if (sourcesHere.length) {
      const placed = await get(token, `/rest/v1/warehouse_locations?origin_ref_type=eq.receiving_shipment` +
        `&origin_ref_item_id=in.(${sourcesHere.map((r) => r.id).join(',')})&quantity=gt.0&select=origin_ref_item_id,quantity`);
      for (const l of placed) placedByOrigin.set(l.origin_ref_item_id, (placedByOrigin.get(l.origin_ref_item_id) || 0) + Number(l.quantity || 0));
    }

    const openHere = (r) => r.shipment && r.shipment.warehouse_country === country && OPEN_RECEPTION.has(String(r.shipment.status || '').toLowerCase())
      && Number(r.quantity_received || 0) > Number(r.received_units || 0);
    const pending = [...pendingById, ...pendingByCode].filter(openHere);

    const names = await namesFor(token,
      [...items.map((i) => i.company_id), ...pending.map((r) => r.shipment.company_id)].filter(Boolean),
      [...items.map((i) => i.user_id), ...pending.map((r) => r.shipment.user_id)].filter(Boolean));

    const expectedRow = (r) => ({
      receptionId: r.shipment.id,
      tracking: r.shipment.tracking_id || null,
      announced: r.shipment.created_at,
      expected: Number(r.quantity_received || 0),
      received: Number(r.received_units || 0),
    });

    const owners = items.map((item) => {
      const locations = locs.filter((l) => l.stock_item_id === item.id).map(locationRow);
      const onShelves = locations.reduce((a, l) => a + l.qty, 0);
      const stock = stockForCountry(item, country);
      // Same limit as the Prep-Center's placement check (received minus what is
      // on shelves from that reception), oldest reception first, and never
      // more than the units actually not on a shelf.
      const sources = sourcesHere
        .filter((r) => r.stock_item_id === item.id)
        .map((r) => {
          const received = Math.max(Number(r.received_units || 0), r.is_received ? Number(r.quantity_received || 0) : 0);
          return {
            itemId: r.id, shipmentId: r.shipment.id, clientId: r.shipment.user_id,
            announced: r.shipment.created_at, room: Math.max(0, received - (placedByOrigin.get(r.id) || 0)),
            title: r.product_name || item.name || null, sku: r.sku || item.sku || null,
          };
        })
        .filter((x) => x.room > 0)
        .sort((a, b) => String(a.announced).localeCompare(String(b.announced)));
      // Every unit in stock that is on no shelf can be placed, however it got
      // into stock: through its receptions first, the rest as a manual move
      // from the receiving area (see putOnShelf).
      const placeable = Math.max(0, stock - onShelves);
      return {
        key: `item:${item.id}`,
        sources,
        placeable,
        client: clientName(names.company.get(item.company_id), names.profile.get(item.user_id)),
        companyId: item.company_id || null,
        clientId: item.user_id || null,
        item,
        stock,
        onShelves,
        notOnShelf: Math.max(0, stock - onShelves),
        locations,
        expected: pending.filter((r) => r.stock_item_id === item.id).map(expectedRow),
      };
    });

    // Announced but no stock item yet: one card per client.
    const byClient = new Map();
    for (const r of pending.filter((x) => !x.stock_item_id)) {
      const k = r.shipment.company_id || r.shipment.user_id || r.shipment.id;
      if (!byClient.has(k)) {
        byClient.set(k, {
          key: `expected:${k}`,
          client: clientName(names.company.get(r.shipment.company_id), names.profile.get(r.shipment.user_id)),
          companyId: r.shipment.company_id || null,
          clientId: r.shipment.user_id || null,
          item: { name: r.product_name || code },
          stock: 0, onShelves: 0, notOnShelf: 0, locations: [], expected: [], sources: [], placeable: 0,
        });
      }
      byClient.get(k).expected.push(expectedRow(r));
    }

    // Owners with something here first, then by units on shelves.
    const all = [...owners, ...byClient.values()].sort((a, b) =>
      (b.onShelves + b.notOnShelf + b.expected.length) - (a.onShelves + a.notOnShelf + a.expected.length));
    return { ok: true, owners: all };
  } catch (err) {
    return fail(err);
  }
}

/**
 * A shelf code → the shelf and what is on it, grouped by client:
 * { ok, shelf: { id, code, warehouseId, active, claim }, groups: [{ client, clientId, rows }] }
 * or { ok: false, reason: 'notShelf' }.
 */
export async function lookupShelf(token, { code = null, id = null, country }) {
  try {
    const place = await readShelf(token, { code, id, country });
    if (!place) return { ok: false, reason: 'notShelf' };
    const [claim, locs] = await Promise.all([
      readClaim(token, place.id),
      get(token, `/rest/v1/warehouse_locations?storage_place_id=eq.${encodeURIComponent(place.id)}&quantity=gt.0` +
        '&select=*,storage_place:storage_places(*),stock_item:stock_items(id,name,image_url,ean,asin,sku,fnsku,company_id,user_id)&order=updated_at.desc'),
    ]);
    const names = await namesFor(token,
      locs.map((l) => l.stock_item?.company_id).filter(Boolean),
      [...locs.map((l) => l.client_id), ...locs.map((l) => l.stock_item?.user_id)].filter(Boolean));

    const groups = new Map();
    for (const l of locs) {
      const owner = l.client_id || l.stock_item?.user_id || 'unknown';
      if (!groups.has(owner)) {
        const profile = names.profile.get(owner) || names.profile.get(l.stock_item?.user_id);
        groups.set(owner, {
          clientId: owner === 'unknown' ? null : owner,
          client: clientName(names.company.get(l.stock_item?.company_id || profile?.company_id), profile),
          rows: [],
        });
      }
      groups.get(owner).rows.push({
        ...locationRow(l),
        name: l.stock_item?.name || l.product_title || l.sku || l.asin || 'Product',
        image: l.stock_item?.image_url || null,
        ean: l.stock_item?.ean || null,
        fnsku: l.stock_item?.fnsku || null,
        stockItemId: l.stock_item_id || l.stock_item?.id || null,
      });
    }
    return {
      ok: true,
      shelf: {
        id: place.id,
        code: place.code,
        warehouseId: place.warehouse_id,
        active: place.active !== false && place.blocked !== true,
        claim: claim ? { status: claim.status, clientId: claim.client_id } : null,
      },
      groups: [...groups.values()],
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Whether `clientId`'s goods may go on the shelf with this code — the same
 * check the website makes before a placement (the Prep-Center checks again,
 * with capacity, when moving).
 */
export async function checkDestination(token, { code, country, clientId }) {
  try {
    const place = await readShelf(token, { code, country });
    if (!place) return { ok: false, reason: 'notShelf' };
    const avail = shelfAvailability(place, await readClaim(token, place.id), clientId);
    if (!avail.ok) return { ok: false, ...avail };
    return { ok: true, shelf: { id: place.id, code: place.code, warehouseId: place.warehouse_id } };
  } catch (err) {
    return fail(err);
  }
}

async function rpc(token, name, body) {
  const res = await prepFetch(`/rest/v1/rpc/${name}`, { method: 'POST', token, body, timeoutMs: 30000 });
  if (res.ok) return { ok: true, data: res.data };
  return {
    ok: false,
    reason: res.status === 0 ? 'offline' : res.status === 401 ? 'unauthorized' : 'failed',
    message: res.data?.message || res.data?.error || `HTTP ${res.status}`,
    status: res.status,
  };
}

/**
 * relocateWarehouseProduct: `qty` units of one shelf row to another shelf.
 * Inventory is unchanged; the Prep-Center logs the move. `key` makes a retry
 * of the same confirmation a no-op instead of a second move.
 */
export function relocate(token, { locationId, toPlaceId, qty, key, notes = null }) {
  return rpc(token, 'warehouse_relocate_product', {
    p_location_id: locationId,
    p_to_storage_place_id: toPlaceId,
    p_quantity: Number(qty),
    p_notes: notes,
    p_source_ref_type: 'manual',
    p_source_ref_id: null,
    p_source_ref_item_id: null,
    p_idempotency_key: key,
  });
}

/** unassignWarehouseProduct: back to the receiving area, inventory unchanged. */
export function unassign(token, { locationId, qty, key, notes = null }) {
  return rpc(token, 'warehouse_unassign_product', {
    p_location_id: locationId,
    p_quantity: Number(qty),
    p_notes: notes,
    p_source_ref_type: 'manual',
    p_source_ref_id: null,
    p_source_ref_item_id: null,
    p_idempotency_key: key,
  });
}

export const newMoveKey = (kind) => opKey(kind === 'unassign' ? 'unassign' : 'relocate');

/**
 * Puts `qty` units that are in stock but on no shelf onto `shelf`, through the
 * receptions they came in by — AdminReceiving's storage-place field
 * (warehouse_set_product_placement with the reception as source), so the
 * Prep-Center checks the units were really received and the stock is not
 * changed. Oldest reception first; whatever is left (units that did not come
 * through a reception) is placed manually. `keys` (by reception line) makes a retry of
 * the same confirmation a no-op. Returns { ok, placed } or { ok: false, placed, ... }.
 */
export async function putOnShelf(token, { owner, qty, shelf, keys }) {
  let left = Number(qty);
  let placed = 0;
  for (const src of owner.sources) {
    if (left <= 0) break;
    const n = Math.min(left, src.room);
    let base = 0;
    try {
      const rows = await get(token, `/rest/v1/warehouse_locations?origin_ref_type=eq.receiving_shipment&origin_ref_item_id=eq.${encodeURIComponent(src.itemId)}` +
        `&storage_place_id=eq.${encodeURIComponent(shelf.id)}&quantity=gt.0&select=quantity`);
      base = rows.reduce((a, r) => a + Number(r.quantity || 0), 0);
    } catch (err) {
      return { ...fail(err), placed };
    }
    keys[src.itemId] ||= opKey('placement');
    const res = await rpc(token, 'warehouse_set_product_placement', {
      p_warehouse_id: shelf.warehouseId,
      p_client_id: src.clientId,
      p_base_quantity: base,
      p_target_quantity: base + n,
      p_from_storage_place_id: base > 0 ? shelf.id : null,
      p_to_storage_place_id: shelf.id,
      p_stock_item_id: owner.item.id,
      p_product_title: src.title,
      p_sku: src.sku,
      p_asin: owner.item.asin || null,
      p_lot_code: null,
      p_expiration_date: null,
      p_notes: null,
      p_source_ref_type: 'receiving_shipment',
      p_source_ref_id: src.shipmentId,
      p_source_ref_item_id: src.itemId,
      p_idempotency_key: keys[src.itemId],
    });
    if (!res.ok) return { ...res, placed };
    placed += n;
    left -= n;
  }
  // Units that came in another way (added in the portal, imported, adjusted):
  // the Prep-Center's own manual shelf placement — a transfer from the
  // receiving area to the shelf (warehouse_place_product, source 'manual',
  // movement 'relocate'). It records the location only; stock is not changed.
  if (left > 0) {
    keys.manual ||= opKey('place');
    const res = await rpc(token, 'warehouse_place_product', {
      p_storage_place_id: shelf.id,
      p_warehouse_id: shelf.warehouseId,
      p_quantity: left,
      p_client_id: owner.clientId || owner.sources[0]?.clientId || null,
      p_stock_item_id: owner.item.id,
      p_product_title: owner.item.name || null,
      p_sku: owner.item.sku || null,
      p_asin: owner.item.asin || null,
      p_lot_code: null,
      p_expiration_date: null,
      p_notes: null,
      p_source_ref_type: 'manual',
      p_source_ref_id: null,
      p_source_ref_item_id: null,
      p_movement_type: 'relocate',
      p_idempotency_key: keys.manual,
    });
    if (!res.ok) return { ...res, placed };
    placed += left;
    left = 0;
  }
  return { ok: true, placed };
}
