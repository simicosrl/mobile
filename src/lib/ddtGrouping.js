// Which DDTs a finished outbound session produces.
//
// The rule, as specified: a DDT covers one shipping and contains only the
// tracking IDs actually scanned in this session — never the rest of the
// shipment. One shipping scanned across two days is two DDTs, each listing just
// that day's boxes. Several shippings in one session are several DDTs.
//
// So: one DDT per (session x shipping). This is deliberately a pure function —
// it is the rule the whole feature rests on, so it is testable on its own
// rather than buried in the sync path.

export function groupForDdt(parcels) {
  const groups = [];
  const byShipment = new Map();
  const unresolved = [];

  for (const parcel of Array.isArray(parcels) ? parcels : []) {
    const shipmentId = parcel?.shipmentId;
    if (!shipmentId) {
      // No shipping means the prep center could not place this box: a code it
      // does not know, or a parcel logged by photo with no readable code.
      // It is flagged for the operator instead of being quietly dropped into
      // someone else's document.
      unresolved.push(parcel);
      continue;
    }
    let group = byShipment.get(shipmentId);
    if (!group) {
      // First box of this shipping decides the group's order and carries the
      // shipment-level details the DDT header needs.
      group = { shipmentId, fbaId: parcel.fbaId || null, parcels: [] };
      byShipment.set(shipmentId, group);
      groups.push(group);
    }
    if (!group.fbaId && parcel.fbaId) group.fbaId = parcel.fbaId;
    group.parcels.push(parcel);
  }

  return { groups, unresolved };
}

// Boxes on a DDT is the number of scanned parcels in the group, not the
// shipment's total — that is the whole point of a partial document.
export function boxCount(group) {
  return group?.parcels?.length || 0;
}

// The products table must describe only what is in the scanned boxes. Each
// parcel carries its own contents (the prep center has to report contents per
// box for this to be correct); identical SKUs across boxes are summed.
export function productLines(group) {
  const lines = new Map();
  for (const parcel of group?.parcels || []) {
    for (const item of parcel.contents || []) {
      const key = item.sku || item.asin || item.description;
      if (!key) continue;
      const existing = lines.get(key);
      if (existing) existing.qty += Number(item.qty) || 0;
      else lines.set(key, { ...item, qty: Number(item.qty) || 0 });
    }
  }
  return [...lines.values()];
}

export function totalWeightKg(group) {
  let total = 0;
  let any = false;
  for (const parcel of group?.parcels || []) {
    // Number(null) is 0 and passes isFinite, which would print a missing
    // weight as "0.00 kg" on a legal document. Absent has to stay absent.
    if (parcel.weightKg === null || parcel.weightKg === undefined || parcel.weightKg === '') continue;
    const w = Number(parcel.weightKg);
    if (Number.isFinite(w)) {
      total += w;
      any = true;
    }
  }
  return any ? Math.round(total * 100) / 100 : null;
}
