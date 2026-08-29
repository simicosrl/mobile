// Real REST client for the "send/receive data via API" feature (API tab).
// Talks to whatever ERP/back office endpoint the operator configures —
// there is no bundled server, so every call is a genuine fetch() against
// the configured base URL and will fail until a real endpoint answers it.
// That failure path is itself part of the feature (queue shows "failed",
// Retry re-sends).

// Our own dedicated backend (a Supabase Edge Function backed by a
// per-country-isolated database — see docs/WMS-App-API-Integration-Guide.pdf)
// rather than a generic "bring your own ERP" placeholder. Still editable —
// this is just the default so a fresh install doesn't need it typed in.
export const DEFAULT_BASE_URL = 'https://piafchajbkfkyftumxke.supabase.co/functions/v1/wms-api';
// One static key per country, registered server-side against that
// country's schema only (see admin.scanner_keys) — baked in so the app is
// connected to its own database out of the box, with zero setup from the
// operator. The visible API screen is reserved for a separate, optional
// connection (e.g. Prep-Center) — it has nothing to do with this pipeline.
export const DEFAULT_SCANNER_KEYS = {
  IT: 'whs_ab0c2b8f5ee0ec80f413ceb86820af732db6ebe051b8a213',
  FR: 'whs_32a0096bcf9ae40ca05ac891dd237540c6367908a8b0c7fa',
  DE: 'whs_03f62f08e77cf839176692d5e92badddf53db34651c69cd0',
};

export const ENDPOINTS = [
  { method: 'POST', path: '/warehouse/sessions', note: 'Sends a confirmed document: header, parcel list, damage photos, signature and the rendered handover PDF (all base64).' },
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
  const { signal, cancel } = withTimeout(options.timeoutMs || 15000);
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
    // Redundant with the backend's own key→country lookup, but useful as
    // an audit trail — if a key is ever mixed up between warehouses this
    // shows up as a mismatch in the payload rather than silently landing
    // in the wrong country's tables.
    country: document.country || null,
    carrier: document.carrier,
    driver: { name: document.driverName || null, plate: document.plate || null },
    operator: document.operatorBadge || document.operator,
    closed_at: document.closedAtIso,
    parcels: document.parcels.map((p) => ({
      tracking: p.code,
      boxes: p.boxes,
      expected: p.expected ?? null,
      // p.photo is just a locally-generated filename label (IMG_x_y.jpg) —
      // the actual image bytes live in p.photoDataUrl. Sending the filename
      // here silently shipped documents with no real photo attached.
      damage: p.damage ? { type: p.damage, photo: p.photoDataUrl || null } : null,
    })),
    signature: document.signatureDataUrl || null,
    // Base64 PDF of the exact handover document the app renders on-device,
    // so the portal can show/store the same file the operator would print —
    // rather than having to re-derive its own from the structured fields.
    pdf: document.pdfDataUrl || null,
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
  // Carries a rendered PDF and any damage photos inline as base64, which can
  // run into a few MB — the default 15s timeout is tuned for small JSON
  // bodies and was cutting this off over slower warehouse connections.
  return request(config, '/warehouse/sessions', { method: 'POST', body: sessionToPayload(document), timeoutMs: 60000 });
}

export async function pullManifest(config) {
  const res = await request(config, '/warehouse/manifest?date=today');
  if (res.ok && Array.isArray(res.data)) return { ok: true, codes: res.data };
  if (res.ok && Array.isArray(res.data?.tracking_ids)) return { ok: true, codes: res.data.tracking_ids };
  return { ok: false, error: describeError(res) };
}

// Looks up which country a badge belongs to — the authoritative,
// server-side source now that operators can no longer pick their own
// country. Any of the three per-country keys works here (the route isn't
// schema-scoped); IT is just an arbitrary fixed choice. A strict 404 is the
// only thing treated as "this badge really has no assignment" — every other
// outcome (network error, timeout, 500, malformed response) must be treated
// as "couldn't check", never misread as "unassigned", or a bad deploy/DB
// hiccup would fleet-lock every operator out with a false "contact the
// office" message.
export async function fetchBadgeCountry(badgeId) {
  const res = await request(
    { baseUrl: DEFAULT_BASE_URL, apiKey: DEFAULT_SCANNER_KEYS.IT },
    `/admin/badge-country/${encodeURIComponent(badgeId)}`,
  );
  if (res.status === 404) return { ok: false, notFound: true };
  // `label` is the operator's registered name for this badge — badge login
  // is scan-only, so this is the only source for a name, never something
  // typed in on the device.
  if (res.ok && res.data?.country) return { ok: true, country: res.data.country, label: res.data.label || null };
  return { ok: false, notFound: false };
}

// Records a successful badge login for the audit trail (Settings › Login
// history) — fire-and-forget from the caller, a failure here must never
// block or fail an actual login.
export async function recordLoginEvent(config, { badgeId, operatorName, country }) {
  return request(config, '/admin/login-event', { method: 'POST', body: { badgeId, operatorName, country }, timeoutMs: 10000 });
}

export async function fetchLoginEvents(config, limit = 100) {
  const res = await request(config, `/admin/login-events?limit=${limit}`);
  if (res.ok && Array.isArray(res.data?.events)) return { ok: true, events: res.data.events };
  return { ok: false, error: describeError(res) };
}

export async function pushDamage(config, trackingId, payload) {
  return request(config, `/warehouse/parcels/${encodeURIComponent(trackingId)}/damage`, { method: 'POST', body: payload, timeoutMs: 30000 });
}

// Reserves the next progressive document number for this country+direction
// *before* the app builds/prints the handover PDF, so the printed number is
// guaranteed to match what actually lands in the database — a locally
// generated placeholder could otherwise drift from the real counter (e.g.
// after a reinstall, or a second device active on the same country).
export async function reserveDocNumber(config, direction) {
  const res = await request(config, '/warehouse/next-doc-number', { method: 'POST', body: { direction }, timeoutMs: 10000 });
  if (res.ok && res.data?.document) return { ok: true, document: res.data.document };
  return { ok: false, error: describeError(res) };
}

// Pulls this country's remembered driver profiles — shared across every
// device/operator logged into it, so a driver's details survive an app
// reinstall instead of living only in that one phone's local storage.
export async function fetchDriverProfiles(config) {
  const res = await request(config, '/warehouse/drivers');
  if (res.ok && Array.isArray(res.data?.drivers)) return { ok: true, drivers: res.data.drivers };
  return { ok: false, error: describeError(res) };
}

export async function pushDriverProfile(config, profile) {
  return request(config, '/warehouse/drivers', {
    method: 'POST',
    body: { name: profile.name, courierCompany: profile.courierCompany, plate: profile.plate, lastUsedAt: profile.lastUsedAt },
    timeoutMs: 10000,
  });
}

// This country's carrier list — each carrier optionally carries a required
// tracking-code prefix (e.g. UPS -> "1Z") the app enforces at scan time.
export async function fetchCarriers(config) {
  const res = await request(config, '/warehouse/carriers');
  if (res.ok && Array.isArray(res.data?.carriers)) return { ok: true, carriers: res.data.carriers };
  return { ok: false, error: describeError(res) };
}

export async function pushCarrier(config, { name, pattern }) {
  return request(config, '/warehouse/carriers', { method: 'POST', body: { name, pattern: pattern || null }, timeoutMs: 10000 });
}

// This country's full session history (lean — no PDF/damage-photo blobs),
// so History/Documents show every device's sessions, not just this one's.
export async function fetchSessions(config, days = 30) {
  const res = await request(config, `/warehouse/sessions?days=${days}`, { timeoutMs: 20000 });
  if (res.ok && Array.isArray(res.data?.sessions)) return { ok: true, sessions: res.data.sessions };
  return { ok: false, error: describeError(res) };
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
      { tracking: 'TBA303120456789', boxes: 2, expected: false, damage: { type: 'Seal broken', photo: 'data:image/jpeg;base64,/9j/4AAQ…' } },
    ],
    signature: 'data:image/png;base64,iVBORw0…',
    pdf: 'data:application/pdf;base64,JVBERi0…',
  },
  null,
  2,
);
