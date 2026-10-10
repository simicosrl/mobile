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
 * Returns { ok, received, placedOn, placementError, unchanged } or
 * { ok: false, reason, message }.
 */
export async function setReceivedUnits(token, { shipmentId, itemId, target, actorId, country }) {
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

    const assigned = await assignedQuantity(token, shipmentId, item);
    if (parsed < assigned) return { ok: false, reason: 'belowAssigned', assigned, received: current };

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
      const warehouseId = await warehouseForCountry(token, shipment.warehouse_country || country);
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

    // --- autoPlaceNewStockOnClientShelf: never undoes the receipt ---
    let placedOn = null;
    let placementError = null;
    if (reconciledDelta > 0 && shipment.user_id) {
      try {
        const shelf = await clientDefaultShelf(token, shipment.user_id, shipment.warehouse_country || country);
        if (shelf?.warehouseId) {
          await rest(token, '/rest/v1/rpc/warehouse_auto_place_received_stock', {
            method: 'POST',
            body: {
              p_payload: {
                warehouse_id: shelf.warehouseId,
                client_id: shipment.user_id,
                quantity: reconciledDelta,
                storage_place_id: shelf.id,
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
          placedOn = shelf.code;
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
