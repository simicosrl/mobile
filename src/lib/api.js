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
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json().catch(() => null) : await res.text().catch(() => null);
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

export async function pushSession(config, document) {
  return request(config, '/warehouse/sessions', { method: 'POST', body: sessionToPayload(document) });
}

export async function pullManifest(config) {
  const res = await request(config, '/warehouse/manifest?date=today');
  if (res.ok && Array.isArray(res.data)) return { ok: true, codes: res.data };
  if (res.ok && Array.isArray(res.data?.tracking_ids)) return { ok: true, codes: res.data.tracking_ids };
  return { ok: false, error: res.error || `HTTP ${res.status}` };
}

export async function pushDamage(config, trackingId, payload) {
  return request(config, `/warehouse/parcels/${encodeURIComponent(trackingId)}/damage`, { method: 'POST', body: payload });
}

export async function fetchArchivedPdf(config, docNo) {
  return request(config, `/warehouse/sessions/${encodeURIComponent(docNo)}/pdf`);
}

export const PAYLOAD_SAMPLE = JSON.stringify(
  {
    document: 'SM-IN-000241',
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
