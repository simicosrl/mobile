// Recording received units on the Prep-Center — the same steps, in the same
// order, as its admin Receiving page, so a unit received from the phone is
// indistinguishable from one received on the website. Nothing on the
// Prep-Center side is changed or added: every call below is one its web
// portal already makes, as the signed-in operator.
//
// Source of each step (prep-center repo):
//   AdminReceiving.jsx   saveReceivedUnitsToServer → applyReceivedUnits
//                        → reconcileReceivedItemInventory → autoPlaceNewStockOnClientShelf
//   config/supabase.js   adjustInventoryForReceiving / syncReceivingInventoryAdjustments,
//                        logWarehouseMovement, updateReceivingItem,
//                        syncReceivingShipmentStatus, runReceivingSideEffects,
//                        ensureReceivingShipmentDefaultLots, saveReceivingItemLots,
//                        autoPlaceReceivingStock
//   utils/receivingFba.js resolveFbaIntent, encodeRemainingAction
//   utils/receivingPlacements.js listLiveReceivingPlacements
// When any of those change on the Prep-Center, this file has to follow.
//
// Only standard receptions: Amazon removal orders have their own inspection
// flow on the website and are never written from the app.

import { prepFetch } from './prepAuth';

const TERMINAL_STATUSES = new Set(['received', 'partially_forwarded', 'forwarded', 'cancelled']);

const opKey = (prefix) => `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

class SaveError extends Error {
  constructor(reason, message, status) {
    super(message || reason);
    this.reason = reason;
    this.status = status;
  }
}

async function rest(token, path, opts = {}) {
  const res = await prepFetch(path, { token, ...opts });
  if (!res.ok) {
    const msg = res.data?.message || res.data?.error || res.data?.msg || (typeof res.data === 'string' ? res.data : '');
    throw new SaveError(res.status === 0 ? 'offline' : res.status === 401 ? 'unauthorized' : 'failed', msg || `HTTP ${res.status}`, res.status);
  }
  return res.data;
}

// utils/receivingFba.js
function resolveFbaIntent(item) {
  const isDirect = item?.remaining_action === 'direct_to_amazon';
  const hasSendProp = Object.prototype.hasOwnProperty.call(item || {}, 'send_to_fba');
  const hasIntent = hasSendProp ? Boolean(item.send_to_fba) : isDirect;
  return { hasIntent, qty: hasIntent ? Math.max(0, Number(item.fba_qty) || 0) : 0, directFromAction: isDirect };
}
const encodeRemainingAction = (sendToFba) => (sendToFba ? 'direct_to_amazon' : 'hold_for_prep');

/** The reception fields every save needs, read fresh. */
export async function loadShipmentForSave(token, shipmentId) {
  const rows = await rest(token,
    `/rest/v1/receiving_shipments?id=eq.${encodeURIComponent(shipmentId)}` +
    '&select=id,status,company_id,user_id,warehouse_country,destination_country,fba_mode,import_source');
  const shipment = Array.isArray(rows) ? rows[0] : null;
  if (!shipment) throw new SaveError('notFound', 'Reception not found');
  return shipment;
}

async function loadItem(token, itemId) {
  const rows = await rest(token,
    `/rest/v1/receiving_items?id=eq.${encodeURIComponent(itemId)}` +
    '&select=*,stock_item:stock_items(id,asin,name,sku,fnsku,ean,internal_code)');
  const item = Array.isArray(rows) ? rows[0] : null;
  if (!item) throw new SaveError('notFound', 'Product line not found');
  return item;
}

async function itemHasLots(token, itemId) {
  const rows = await rest(token, `/rest/v1/stock_lots?receiving_item_id=eq.${encodeURIComponent(itemId)}&select=id&limit=1`);
  return Array.isArray(rows) && rows.length > 0;
}

// Units of this line already on a shelf (utils/receivingPlacements.js +
// AdminReceiving getAssignedQtyForItem). Received units can't go below it.
async function assignedQuantity(token, shipmentId, item) {
  const rows = await rest(token,
    `/rest/v1/warehouse_locations?origin_ref_type=eq.receiving_shipment&origin_ref_id=eq.${encodeURIComponent(shipmentId)}` +
    '&quantity=gt.0&select=quantity,sku,asin,origin_ref_item_id');
  const list = Array.isArray(rows) ? rows : [];
  const specific = list.filter((r) => r.origin_ref_item_id === item.id);
  if (specific.length) return specific.reduce((a, r) => a + Number(r.quantity || 0), 0);
  const norm = (v) => String(v || '').toLowerCase().trim();
  const sku = norm(item.sku || item.stock_item?.sku);
  const asin = norm(item.asin || item.stock_item?.asin || item.ean_asin || item.ean);
  return list
    .filter((r) => !r.origin_ref_item_id && norm(r.sku) === sku && norm(r.asin) === asin)
    .reduce((a, r) => a + Number(r.quantity || 0), 0);
}

// Same choice as AdminReceiving: the warehouse of the country's first active
// storage place (by code), else the country's newest active warehouse.
const warehouseCache = new Map();
async function warehouseForCountry(token, country) {
  if (warehouseCache.has(country)) return warehouseCache.get(country);
  const warehouses = await rest(token,
    `/rest/v1/warehouses?country=eq.${encodeURIComponent(country)}&select=id,active,created_at&order=created_at.desc`);
  const ids = (warehouses || []).map((w) => w.id);
  let id = null;
  if (ids.length) {
    const places = await rest(token,
      `/rest/v1/storage_places?active=eq.true&warehouse_id=in.(${ids.join(',')})&select=warehouse_id&order=code.asc&limit=1`);
    id = places?.[0]?.warehouse_id || (warehouses || []).find((w) => w.active === true)?.id || null;
  }
  if (id) warehouseCache.set(country, id);
  return id;
}

// The client's putaway default shelf in this country, if they have one
// (listClientPutawayDefaults + defaultStoragePlaceId). The Prep-Center's RPC
// re-checks the claim and refuses a shelf that is no longer the client's.
async function clientDefaultShelf(token, clientId, country) {
  if (!clientId) return null;
  const rows = await rest(token,
    `/rest/v1/client_putaway_defaults?client_id=eq.${encodeURIComponent(clientId)}` +
    '&select=storage_place_id,warehouse_id,updated_at,storage_place:storage_places(id,code,active,warehouse_id),warehouse:warehouses(id,country)' +
    '&order=updated_at.desc');
  const hit = (rows || []).find((r) =>
    r.storage_place?.active === true && String(r.warehouse?.country || '').toUpperCase() === country);
  return hit ? { id: hit.storage_place.id, code: hit.storage_place.code, warehouseId: hit.storage_place.warehouse_id || hit.warehouse_id } : null;
}

/** The client's default shelf, for showing where units will go. Never throws. */
export async function loadClientDefaultShelf(token, clientId, country) {
  try {
    return { ok: true, shelf: await clientDefaultShelf(token, clientId, country) };
  } catch (err) {
    return { ok: false, reason: err.reason || 'failed', status: err.status };
  }
}

const claimOwner = (c) =>
  c?.client?.company_name || c?.client?.store_name ||
  [c?.client?.first_name, c?.client?.last_name].filter(Boolean).join(' ') || 'another client';

// utils/warehousePlacement.js isStoragePlaceAvailableForClient, with the
// website's own messages (AdminReceiving saveInlinePlacementDraft).
export function shelfAvailability(place, claim, clientId) {
  if (!place || place.active === false || place.blocked === true) return { ok: false, reason: 'shelfInactive', message: `Shelf ${place?.code || ''} is not active.` };
  if (!claim) return { ok: true };
  if (claim.status === 'empty_pending_check') {
    return { ok: false, reason: 'shelfUnavailable', message: `Shelf ${place.code} must be verified empty before reuse.` };
  }
  if (claim.status === 'conflict' || String(claim.client_id || '').trim() !== String(clientId || '').trim()) {
    return { ok: false, reason: 'shelfUnavailable', message: `Shelf ${place.code} is unavailable (${claimOwner(claim)}).` };
  }
  return { ok: true };
}

export async function readShelf(token, { id = null, code = null, country }) {
  const warehouses = await rest(token, `/rest/v1/warehouses?country=eq.${encodeURIComponent(country)}&select=id`);
  const ids = (warehouses || []).map((w) => w.id);
  if (!ids.length) return null;
  // Codes compare trimmed and case-insensitively (normalizeStoragePlaceCode);
  // ilike with no wildcards is exactly that, once % and _ are escaped.
  const wanted = String(code || '').trim().toUpperCase();
  if (!id && (!wanted || wanted.includes('*'))) return null; // * is PostgREST's wildcard
  const filter = id
    ? `id=eq.${encodeURIComponent(id)}`
    : `code=ilike.${encodeURIComponent(wanted.replace(/[\\%_]/g, (m) => `\\${m}`))}`;
  const places = await rest(token, `/rest/v1/storage_places?${filter}&warehouse_id=in.(${ids.join(',')})&select=*&limit=5`);
  const exact = (Array.isArray(places) ? places : [])
    .filter((pl) => id || String(pl.code || '').trim().toUpperCase() === wanted);
  return exact.length === 1 ? exact[0] : null;
}

export async function readClaim(token, placeId) {
  const rows = await rest(token,
    `/rest/v1/storage_place_claims?storage_place_id=eq.${encodeURIComponent(placeId)}` +
    '&select=storage_place_id,client_id,status,client:profiles!storage_place_claims_client_id_fkey(company_name,store_name,first_name,last_name)');
  return Array.isArray(rows) ? rows[0] || null : null;
}

/**
 * A scanned or typed shelf code → the shelf, if it exists in this country and
 * may take this client's goods. { ok, shelf: { id, code, warehouseId } } |
 * { ok: false, reason: 'notShelf' | 'shelfUnavailable' | 'shelfInactive' | ..., message }.
 */
export async function findShelf(token, { code, country, clientId }) {
  try {
    const place = await readShelf(token, { code, country });
    if (!place) return { ok: false, reason: 'notShelf' };
    const avail = shelfAvailability(place, await readClaim(token, place.id), clientId);
    if (!avail.ok) return { ok: false, ...avail };
    return { ok: true, shelf: { id: place.id, code: place.code, warehouseId: place.warehouse_id } };
  } catch (err) {
    return { ok: false, reason: err.reason || 'failed', message: err.message, status: err.status };
  }
}

// Units of this line from this reception sitting on one shelf right now.
async function quantityOnShelf(token, shipmentId, itemId, placeId) {
  const rows = await rest(token,
    `/rest/v1/warehouse_locations?origin_ref_type=eq.receiving_shipment&origin_ref_id=eq.${encodeURIComponent(shipmentId)}` +
    `&origin_ref_item_id=eq.${encodeURIComponent(itemId)}&storage_place_id=eq.${encodeURIComponent(placeId)}&quantity=gt.0&select=quantity`);
  return (rows || []).reduce((a, r) => a + Number(r.quantity || 0), 0);
}

// AdminReceiving saveInlinePlacementDraft → setWarehouseProductPlacement:
// the line's units on `shelf` go from `base` to `target` (more: placed from
// the receiving area; fewer: unassigned back to it).
async function setShelfQuantity(token, { shelf, shipment, item, base, target }) {
  const stock = item.stock_item || {};
  await rest(token, '/rest/v1/rpc/warehouse_set_product_placement', {
    method: 'POST',
    body: {
      p_warehouse_id: shelf.warehouseId,
      p_client_id: shipment.user_id || null,
      p_base_quantity: base,
      p_target_quantity: target,
      p_from_storage_place_id: base > 0 ? shelf.id : null,
      p_to_storage_place_id: shelf.id,
      p_stock_item_id: item.stock_item_id || stock.id || null,
      p_product_title: item.product_name || stock.name || null,
      p_sku: item.sku || stock.sku || null,
      p_asin: item.asin || stock.asin || item.ean_asin || item.ean || null,
      p_lot_code: null,
      p_expiration_date: null,
      p_notes: null,
      p_source_ref_type: 'receiving_shipment',
      p_source_ref_id: shipment.id,
      p_source_ref_item_id: item.id,
      p_idempotency_key: opKey('placement'),
    },
  });
}

/** A line's received units as the Prep-Center has them right now. */
export async function readReceivedUnits(token, itemId) {
  try {
    const rows = await rest(token, `/rest/v1/receiving_items?id=eq.${encodeURIComponent(itemId)}&select=received_units`);
    if (!Array.isArray(rows) || !rows.length) return { ok: false, reason: 'notFound' };
    return { ok: true, received: Math.max(0, Number(rows[0].received_units || 0)) };
  } catch (err) {
    return { ok: false, reason: err.reason || 'failed', message: err.message, status: err.status };
  }
}

/**
 * Set a line's received units to `target`, exactly as the website's
 * "Received units" field does. Re-reads the line first; every step is safe to
 * repeat with the same target (the stock step is a target, not a delta).
 *
 * `shelf` ({ id, code, warehouseId }): put the newly received units on that
 * shelf, as the website's storage-place field does. Without it they go to
 * the client's default shelf, as the website does automatically. Lowering
 * the count first takes the units back off that same shelf (the website
 * makes the operator unassign before lowering; this does both steps).
 *
 * Returns { ok, received, placedOn, placementError, unchanged } or
 * { ok: false, reason, message }.
 */
export async function setReceivedUnits(token, { shipmentId, itemId, target, actorId, country, shelf = null }) {
  try {
    const parsed = Math.max(0, Math.floor(Number(target) || 0));
    const shipment = await loadShipmentForSave(token, shipmentId);
    if (String(shipment.import_source || '').toLowerCase() === 'amazon_removal_order') {
      return { ok: false, reason: 'removalOrder' };
    }
    if (String(shipment.status || '').toLowerCase() === 'cancelled') return { ok: false, reason: 'cancelled' };
    const item = await loadItem(token, itemId);
    const stock = item.stock_item || {};
    const current = Math.max(0, Number(item.received_units || 0));

    if (parsed === current) {
      // Nothing to record; the website still makes sure a received line has
      // its default lot.
      if (parsed > 0 && !(await itemHasLots(token, item.id))) {
        await rest(token, '/rest/v1/rpc/upsert_receiving_item_lots', {
          method: 'POST', body: { p_receiving_item_id: item.id, p_lots: [], p_actor: actorId },
        });
      }
      return { ok: true, received: current, unchanged: true };
    }

    const shipmentCountry = shipment.warehouse_country || country;
    let assigned = await assignedQuantity(token, shipmentId, item);
    if (parsed < assigned) {
      // Take the surplus back off the shelf these units were put on — the
      // chosen one, else the client's default — if it holds enough of them.
      const from = shelf || await clientDefaultShelf(token, shipment.user_id, shipmentCountry);
      const need = assigned - parsed;
      const onShelf = from ? await quantityOnShelf(token, shipmentId, item.id, from.id) : 0;
      if (!from?.warehouseId || onShelf < need) return { ok: false, reason: 'belowAssigned', assigned, received: current };
      await setShelfQuantity(token, { shelf: from, shipment, item, base: onShelf, target: onShelf - need });
      assigned -= need;
    }

    // --- applyReceivedUnits: the line's new values ---
    const delta = parsed - current;
    const payload = { received_units: parsed };
    if (parsed > 0 && !item.received_by) payload.received_by = actorId;
    const expected = Math.max(0, Number(item.quantity_received || 0));
    payload.is_received = expected > 0 && parsed >= expected;
    const intent = resolveFbaIntent(item);
    const currentFbaQty = Math.max(0, Number(item.fba_qty || 0));
    const fbaReserve = shipment.fba_mode === 'full'
      ? expected
      : currentFbaQty || (intent.directFromAction ? expected : 0);
    const currentQtyToStock = Math.max(0, Number(item.quantity_to_stock || 0));
    const qtyToStock = parsed;
    const stockDelta = qtyToStock - currentQtyToStock;
    payload.quantity_to_stock = qtyToStock;
    payload.send_to_fba = fbaReserve > 0;
    payload.fba_qty = fbaReserve > 0 ? fbaReserve : null;
    payload.remaining_action = encodeRemainingAction(fbaReserve > 0);

    // --- reconcileReceivedItemInventory: stock first ---
    const sideEffects = await rest(token, '/functions/v1/receiving-side-effects', {
      method: 'POST',
      timeoutMs: 30000,
      body: {
        shipment_id: shipmentId,
        inventory_adjustments: [{
          receiving_item_id: item.id,
          quantity_moved: stockDelta,
          target_quantity: qtyToStock,
          processed_by: actorId,
          company_id: shipment.company_id || null,
          stock_item_id: item.stock_item_id || null,
          product_name: item.product_name || null,
          ean_asin: item.ean_asin || null,
          asin: item.asin || stock.asin || null,
          sku: item.sku || stock.sku || null,
          ean: item.ean || stock.ean || null,
          fnsku: item.fnsku || stock.fnsku || null,
          internal_code: item.internal_code || stock.internal_code || null,
          purchase_price: item.purchase_price ?? null,
          amazon_removal_condition: null,
        }],
      },
    });
    if (sideEffects?.inventory?.error) throw new SaveError('failed', String(sideEffects.inventory.error));
    const inv = Array.isArray(sideEffects?.inventory) ? sideEffects.inventory[0] : null;
    const stockItemId = inv?.stock_item_id || item.stock_item_id || null;
    const reconciledDelta = Number(inv?.quantity_moved || 0);

    if (reconciledDelta !== 0) {
      const warehouseId = await warehouseForCountry(token, shipmentCountry);
      if (warehouseId) {
        await rest(token, '/rest/v1/warehouse_movements', {
          method: 'POST',
          body: {
            warehouse_id: warehouseId,
            movement_type: reconciledDelta > 0 ? 'inbound' : 'adjustment',
            client_id: shipment.user_id || null,
            stock_item_id: stockItemId || stock.id || null,
            product_title: item.product_name || stock.name || null,
            sku: item.sku || stock.sku || null,
            asin: item.asin || stock.asin || item.ean_asin || item.ean || null,
            lot_code: null,
            expiration_date: null,
            quantity: reconciledDelta,
            from_storage_place_id: null,
            to_storage_place_id: null,
            source_ref_type: 'receiving_shipment',
            source_ref_id: shipmentId,
            source_ref_item_id: item.id,
            origin_ref_type: 'receiving_shipment',
            origin_ref_id: shipmentId,
            origin_ref_item_id: item.id,
            performed_by: actorId,
            notes: null,
            idempotency_key: opKey('movement'),
          },
        });
      }
    }
    if (stockItemId) payload.stock_item_id = stockItemId;

    // --- updateReceivingItem ---
    const updated = await rest(token, `/rest/v1/receiving_items?id=eq.${encodeURIComponent(item.id)}&select=id`, {
      method: 'PATCH',
      body: payload,
      headers: { Prefer: 'return=representation' },
    });
    if (!Array.isArray(updated) || !updated.length) {
      throw new SaveError('failed', 'Line could not be updated. Refresh the reception and check received units.');
    }
    await syncShipmentStatus(token, shipmentId);
    // Fire-and-forget on the website too (debounced client e-mails etc.).
    prepFetch('/functions/v1/receiving-side-effects', { method: 'POST', token, body: { shipment_id: shipmentId }, timeoutMs: 30000 }).catch(() => {});

    if (delta > 0) {
      await rest(token, '/rest/v1/rpc/ensure_receiving_shipment_default_lots', {
        method: 'POST', body: { p_receiving_shipment_id: shipmentId, p_actor: actorId },
      });
    }

    // --- placement: never undoes the receipt ---
    let placedOn = null;
    let placementError = null;
    if (reconciledDelta > 0 && shipment.user_id) {
      try {
        if (shelf) {
          // saveInlinePlacementDraft: re-check the shelf is still this
          // client's, then add the new units to what the line has there.
          const place = await readShelf(token, { id: shelf.id, country: shipmentCountry });
          const avail = shelfAvailability(place, place ? await readClaim(token, place.id) : null, shipment.user_id);
          if (!avail.ok) throw new Error(avail.message || 'Shelf unavailable');
          const target = { id: place.id, code: place.code, warehouseId: place.warehouse_id };
          const base = await quantityOnShelf(token, shipmentId, item.id, place.id);
          await setShelfQuantity(token, { shelf: target, shipment, item, base, target: base + reconciledDelta });
          placedOn = place.code;
        } else {
          // autoPlaceNewStockOnClientShelf
          const def = await clientDefaultShelf(token, shipment.user_id, shipmentCountry);
          if (def?.warehouseId) {
            await rest(token, '/rest/v1/rpc/warehouse_auto_place_received_stock', {
              method: 'POST',
              body: {
                p_payload: {
                  warehouse_id: def.warehouseId,
                  client_id: shipment.user_id,
                  quantity: reconciledDelta,
                  storage_place_id: def.id,
                  movement_type: 'relocate',
                  stock_item_id: stockItemId || stock.id || null,
                  product_title: item.product_name || stock.name || null,
                  sku: item.sku || stock.sku || null,
                  asin: item.asin || stock.asin || item.ean_asin || item.ean || null,
                  source_ref_type: 'receiving_shipment',
                  source_ref_id: shipmentId,
                  source_ref_item_id: item.id,
                  notes: 'Automatically placed on the client shelf.',
                  idempotency_key: opKey('auto-receiving'),
                },
              },
            });
            placedOn = def.code;
          }
        }
      } catch (err) {
        placementError = err.message || String(err);
      }
    }

    // --- saveReceivedUnitsToServer: a received line always has a lot ---
    if (parsed > 0 && !(await itemHasLots(token, item.id))) {
      await rest(token, '/rest/v1/rpc/upsert_receiving_item_lots', {
        method: 'POST', body: { p_receiving_item_id: item.id, p_lots: [], p_actor: actorId },
      });
    }

    return { ok: true, received: parsed, placedOn, placementError };
  } catch (err) {
    if (err instanceof SaveError) return { ok: false, reason: err.reason, message: err.message, status: err.status };
    return { ok: false, reason: 'failed', message: String(err?.message || err) };
  }
}

// config/supabase.js syncReceivingShipmentStatus (without a receivedBy, as
// updateReceivingItem calls it).
async function syncShipmentStatus(token, shipmentId) {
  const [items, rows] = await Promise.all([
    rest(token, `/rest/v1/receiving_items?shipment_id=eq.${encodeURIComponent(shipmentId)}&select=is_received`),
    rest(token, `/rest/v1/receiving_shipments?id=eq.${encodeURIComponent(shipmentId)}&select=status,received_by,received_at,processed_by`),
  ]);
  const shipment = rows?.[0];
  const currentStatus = shipment?.status || 'submitted';
  if (TERMINAL_STATUSES.has(currentStatus)) return;
  const list = Array.isArray(items) ? items : [];
  const allReceived = list.length > 0 && list.every((it) => it.is_received);
  const someReceived = list.some((it) => it.is_received);
  let next = currentStatus;
  if (allReceived) next = 'received';
  else if (someReceived) next = 'partial';
  else if (['partial', 'received', 'processed'].includes(currentStatus)) next = 'submitted';
  const patch = {};
  if (next !== currentStatus) patch.status = next;
  if (next === 'received') {
    if (!shipment?.received_at) patch.received_at = new Date().toISOString();
    patch.received_by = shipment?.received_by || shipment?.processed_by || null;
  }
  if (!Object.keys(patch).length) return;
  await rest(token, `/rest/v1/receiving_shipments?id=eq.${encodeURIComponent(shipmentId)}`, { method: 'PATCH', body: patch });
}

/**
 * A message on the reception's thread, exactly as the website's thread
 * (ReceivingNoteThread) sends it as staff: the client sees it too.
 * author_id is filled by the Prep-Center from the session.
 */
export async function postReceptionNote(token, shipmentId, body) {
  try {
    const rows = await rest(token, '/rest/v1/receiving_shipment_notes?select=id,sender_type,body,created_at', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: { receiving_shipment_id: shipmentId, sender_type: 'admin', body: String(body || '').trim() },
    });
    return { ok: true, note: Array.isArray(rows) ? rows[0] : rows };
  } catch (err) {
    return { ok: false, reason: err.reason || 'failed', message: err.message, status: err.status };
  }
}
