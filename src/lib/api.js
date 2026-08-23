// Real REST client for the "send/receive data via API" feature (API tab).
// Talks to whatever ERP/back office endpoint the operator configures —
// there is no bundled server, so every call is a genuine fetch() against
// the configured base URL and will fail until a real endpoint answers it.
// That failure path is itself part of the feature (queue shows "failed",
// Retry re-sends).

export const ENDPOINTS = [
  { method: 'POST', path: '/warehouse/sessions', note: 'Sends a confirmed document: header, parcel list, damages, signature (base64 PNG).' },
  { method: 'GET', path: '/warehouse/manifest?date=today', note: 'Returns the tracking IDs expected for the day, per carrier.' },
  { method: 'POST', path: '/warehouse/parcels/{id}/damage', note: 'Pushes a damage record and its photo the moment it is captured.' },
  { method: 'GET', path: '/warehouse/sessions/{doc}/pdf', note: 'Pulls back the archived PDF the ERP generated for a document.' },
];

function withTimeout(ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(id) };
}

async function request(config, path, options = {}) {
  const base = (config.baseUrl || '').replace(/\/+$/, '');
  if (!base) return { ok: false, status: 0, error: 'No base URL configured' };
  const { signal, cancel } = withTimeout(15000);
  try {
    const res = await fetch(base + path, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal,
    });
    cancel();
    // Parse as JSON whenever the body actually is JSON, regardless of the
    // Content-Type header — plenty of real-world WMS/ERP endpoints answer
    // with correct JSON but a missing or wrong content-type, and gating on
    // that header silently broke every response shape check below.
    const text = await res.text().catch(() => '');
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON — keep the raw text */ }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    cancel();
    return { ok: false, status: 0, error: err?.name === 'AbortError' ? 'Request timed out' : String(err?.message || err) };
  }
}

export function sessionToPayload(document) {
  return {
    document: document.doc,
    direction: document.direction === 'out' ? 'outbound' : 'inbound',
    carrier: document.carrier,
    driver: { name: document.driverName || null, plate: document.plate || null },
    operator: document.operatorBadge || document.operator,
    closed_at: document.closedAtIso,
    parcels: document.parcels.map((p) => ({
      tracking: p.code,
      boxes: p.boxes,
      expected: p.expected ?? null,
      damage: p.damage ? { type: p.damage, photo: p.photo || null } : null,
    })),
    signature: document.signatureDataUrl || null,
  };
}

// Turns a request() result into a short, human-readable reason — "failed"
// alone gives no way to tell a bad URL from a rejected key from a route
// that doesn't exist on the backend, so this is shown in toasts and next
// to each row in the API tab's send queue.
export function describeError(res) {
  if (res.error) return res.error;
  if (res.status) {
    const bodyMsg =
      res.data && typeof res.data === 'object'
        ? res.data.message || res.data.error
        : typeof res.data === 'string' && res.data.trim()
          ? res.data.trim().slice(0, 140)
          : null;
    return `HTTP ${res.status}` + (bodyMsg ? ` — ${bodyMsg}` : '');
  }
  return 'Unknown error';
}

export async function pushSession(config, document) {
  return request(config, '/warehouse/sessions', { method: 'POST', body: sessionToPayload(document) });
}

export async function pullManifest(config) {
  const res = await request(config, '/warehouse/manifest?date=today');
  if (res.ok && Array.isArray(res.data)) return { ok: true, codes: res.data };
  if (res.ok && Array.isArray(res.data?.tracking_ids)) return { ok: true, codes: res.data.tracking_ids };
  return { ok: false, error: describeError(res) };
}

export async function pushDamage(config, trackingId, payload) {
  return request(config, `/warehouse/parcels/${encodeURIComponent(trackingId)}/damage`, { method: 'POST', body: payload });
}

/**
 * Fetches the ERP's own archived PDF for a document, as a base64 data URL.
 * Deliberately doesn't go through request() — that helper decodes bodies as
 * text/JSON, which would corrupt binary PDF bytes.
 */
export async function fetchArchivedPdf(config, docNo) {
  const base = (config.baseUrl || '').replace(/\/+$/, '');
  if (!base) return { ok: false, error: 'No base URL configured' };
  const { signal, cancel } = withTimeout(15000);
  try {
    const res = await fetch(`${base}/warehouse/sessions/${encodeURIComponent(docNo)}/pdf`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      signal,
    });
    cancel();
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return { ok: true, dataUrl };
  } catch (err) {
    cancel();
    return { ok: false, error: err?.name === 'AbortError' ? 'Request timed out' : String(err?.message || err) };
  }
}

export const PAYLOAD_SAMPLE = JSON.stringify(
  {
    document: 'WH-IN-000001',
    direction: 'inbound',
    carrier: 'DHL',
    driver: { name: 'Luca Ferri', plate: 'GA 481 KP' },
    operator: 'BADGE-4471',
    closed_at: '2026-08-23T09:41:00+02:00',
    parcels: [
      { tracking: 'JJD014600011234567890', boxes: 1, expected: true, damage: null },
      { tracking: 'TBA303120456789', boxes: 2, expected: false, damage: { type: 'Seal broken', photo: 'IMG_0442.jpg' } },
    ],
    signature: 'data:image/png;base64,iVBORw0…',
  },
  null,
  2,
);
