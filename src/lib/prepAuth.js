// Operators are the Prep-Center's own staff accounts. The app signs in to the
// Prep-Center's Supabase project exactly as its web portal does — same public
// URL and anon key, same Auth, same row-level security — so nothing on the
// Prep-Center side has to change, and every permission it grants or revokes
// applies here too.
//
// Only what the shift needs lives here: password sign-in, MFA, refreshing a
// saved session, reading the operator's profile, and deciding whether that
// profile may use the app. Plain fetch() against Supabase's REST endpoints,
// like the rest of this app, rather than pulling in supabase-js for five calls.

import { Capacitor, CapacitorHttp } from '@capacitor/core';

// Public by design: the same values ship in the prep-center.eu web bundle.
// The anon key grants nothing on its own; access comes from the operator's
// session and the Prep-Center's RLS.
export const PREP_SUPABASE_URL = 'https://muswtkzjfrldhgokkmqw.supabase.co';
export const PREP_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11c3d0a3pqZnJsZGhnb2trbXF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0ODQxMjMsImV4cCI6MjA3MjA2MDEyM30.D-boQV7sA9ztud6PO4fgOTtHPO_pAsufwLvc7IvBLzk';

export const WAREHOUSE_COUNTRIES = ['IT', 'FR', 'DE'];

// The Prep-Center keeps these accounts to its warehouse network
// (src/utils/warehouseNetworkGuard.js there). Its server check is what decides;
// this copy only matters when that check cannot be reached, so a restricted
// account is never let in just because the phone is offline.
const NETWORK_RESTRICTED_STAFF = new Set([
  '7c33ebf8-48ba-444a-ae3c-54564c2e5ffa',
  '77a58255-16f5-4cb3-9735-ef797ec7ac1b',
  'bc3ce361-b5c8-435f-a1b6-7ee9d33b3e67',
]);

const PROFILE_COLUMNS = [
  'id', 'email', 'first_name', 'last_name', 'country', 'allowed_markets', 'status',
  'account_type', 'is_admin', 'is_limited_admin', 'is_operator', 'is_super_admin', 'operator_permissions',
].join(',');

/**
 * One request to the Prep-Center's Supabase (Auth, REST or RPC), as the
 * signed-in operator when `token` is given. Never throws: { ok, status, data },
 * status 0 when the server could not be reached at all.
 */
export async function prepFetch(path, opts) {
  return call(path, opts);
}

async function call(path, { method = 'GET', body, token, timeoutMs = 15000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(PREP_SUPABASE_URL + path, {
      method,
      headers: {
        apikey: PREP_ANON_KEY,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    // status 0 = the server was never reached. Callers treat that as
    // "offline", never as a verdict on the account.
    return { ok: false, status: 0, data: null, error: err?.name === 'AbortError' ? 'timeout' : String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

function toSession(data) {
  if (!data?.access_token || !data?.refresh_token) return null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at ? data.expires_at * 1000 : Date.now() + (data.expires_in || 3600) * 1000,
    user: data.user || null,
  };
}

function authError(res) {
  if (res.status === 0) return { reason: 'offline' };
  const msg = String(res.data?.error_description || res.data?.msg || res.data?.message || res.data?.error || '');
  if (res.status === 400 && /invalid login credentials/i.test(msg)) return { reason: 'badCredentials' };
  if (/email not confirmed/i.test(msg)) return { reason: 'emailNotConfirmed' };
  return { reason: 'authFailed', message: msg || `HTTP ${res.status}` };
}

/** Email + password → session, or { reason }. */
export async function signInWithPassword(email, password) {
  const res = await call('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: String(email || '').trim().toLowerCase(), password: String(password || '') },
  });
  const session = res.ok ? toSession(res.data) : null;
  return session ? { ok: true, session } : { ok: false, ...authError(res) };
}

/**
 * Saved refresh token → fresh session. Supabase rotates refresh tokens, so the
 * caller must store the new one; the old one stops working.
 * `expired: true` means the Prep-Center no longer accepts this session
 * (signed out, password changed, account removed) — ask for the password again.
 */
export async function refreshSession(refreshToken) {
  const res = await call('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: { refresh_token: refreshToken },
  });
  const session = res.ok ? toSession(res.data) : null;
  if (session) return { ok: true, session };
  if (res.status === 0) return { ok: false, reason: 'offline' };
  return { ok: false, reason: 'expired' };
}

/**
 * The verified TOTP factor the Prep-Center would ask for, if any. The web
 * portal requires the code whenever one is enrolled (nextLevel = aal2), so the
 * app does too.
 */
export function pendingMfaFactor(session) {
  const factors = Array.isArray(session?.user?.factors) ? session.user.factors : [];
  const totp = factors.find((f) => f.status === 'verified' && (f.factor_type === 'totp' || !f.factor_type));
  if (!totp) return null;
  // Already aal2 (e.g. a refreshed session that was verified before).
  try {
    const claims = JSON.parse(atob(session.accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (claims?.aal === 'aal2') return null;
  } catch { /* unreadable token — ask for the code rather than skip it */ }
  return totp.id;
}

/** Six-digit authenticator code → an aal2 session. */
export async function verifyMfa(session, factorId, code) {
  const challenge = await call(`/auth/v1/factors/${encodeURIComponent(factorId)}/challenge`, {
    method: 'POST',
    token: session.accessToken,
    body: {},
  });
  if (!challenge.ok || !challenge.data?.id) return { ok: false, ...authError(challenge) };
  const res = await call(`/auth/v1/factors/${encodeURIComponent(factorId)}/verify`, {
    method: 'POST',
    token: session.accessToken,
    body: { challenge_id: challenge.data.id, code: String(code || '').replace(/\s+/g, '') },
  });
  const next = res.ok ? toSession({ ...res.data, user: res.data?.user || session.user }) : null;
  if (next) return { ok: true, session: next };
  if (res.status === 0) return { ok: false, reason: 'offline' };
  return { ok: false, reason: 'badMfaCode' };
}

export async function fetchProfile(session) {
  const userId = session?.user?.id;
  if (!userId) return { ok: false, reason: 'authFailed', message: 'No user in session' };
  const res = await call(`/rest/v1/profiles?select=${PROFILE_COLUMNS}&id=eq.${encodeURIComponent(userId)}`, {
    token: session.accessToken,
  });
  if (res.status === 0) return { ok: false, reason: 'offline' };
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!res.ok || !row) return { ok: false, reason: 'noProfile' };
  return { ok: true, profile: row };
}

export function displayName(profile) {
  return [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() || profile?.email || 'Operator';
}

/**
 * The Prep-Center's own rule for its admin area (operatorPermissions.js +
 * AdminRoute): staff only, and an operator only for the sections it has been
 * granted. This app is the "Warehouse" section.
 */
export function evaluateAccess(profile) {
  if (!profile) return { allowed: false, reason: 'noProfile' };
  if (String(profile.status || '').toLowerCase() === 'inactive') return { allowed: false, reason: 'inactive' };
  const isStaff = profile.is_admin === true || profile.account_type === 'admin';
  if (!isStaff) return { allowed: false, reason: 'notStaff' };
  if (profile.is_operator === true && profile.operator_permissions?.warehouse !== true) {
    return { allowed: false, reason: 'noWarehousePermission' };
  }
  return { allowed: true };
}

/**
 * Warehouse countries this profile may run a shift in. Operators are scoped to
 * their profile country; administrators to every market they are allowed.
 */
export function shiftCountries(profile) {
  const norm = (c) => String(c || '').trim().toUpperCase();
  const list = profile?.is_operator === true
    ? [norm(profile.country)]
    : [norm(profile?.country), ...(Array.isArray(profile?.allowed_markets) ? profile.allowed_markets.map(norm) : [])];
  return [...new Set(list)].filter((c) => WAREHOUSE_COUNTRIES.includes(c));
}

/**
 * The Prep-Center's warehouse-network rule. Its verify function only answers
 * the portal's own origins (CORS), so on the phone it is called through the
 * native HTTP layer, where CORS does not apply. The rule itself is applied
 * unchanged: if it says no, the operator does not get in.
 */
export async function checkWarehouseNetwork(session) {
  const userId = session?.user?.id;
  const restricted = NETWORK_RESTRICTED_STAFF.has(userId);
  const url = `${PREP_SUPABASE_URL}/functions/v1/verify-staff-warehouse-network`;
  const headers = { Authorization: `Bearer ${session.accessToken}`, apikey: PREP_ANON_KEY };
  try {
    let status;
    let data;
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.post({ url, headers, data: {}, connectTimeout: 10000, readTimeout: 10000 });
      status = res.status;
      data = typeof res.data === 'string' ? JSON.parse(res.data || 'null') : res.data;
    } else {
      const res = await fetch(url, { method: 'POST', headers });
      status = res.status;
      data = await res.json().catch(() => null);
    }
    if (status >= 200 && status < 300 && data?.allowed === true) return { allowed: true };
    if (status === 403) return { allowed: false, reason: 'warehouseNetwork' };
    // Any other answer: unknown. Only restricted accounts are held back by it.
    return restricted ? { allowed: false, reason: 'warehouseNetworkUnverified' } : { allowed: true };
  } catch {
    return restricted ? { allowed: false, reason: 'warehouseNetworkUnverified' } : { allowed: true };
  }
}

export function isNetworkRestricted(userId) {
  return NETWORK_RESTRICTED_STAFF.has(userId);
}

/**
 * Ends one saved session on the Prep-Center (this phone's only — other devices
 * of the same operator stay signed in). Best effort: forgetting it locally is
 * what matters, and that happens regardless.
 */
export async function signOut(refreshToken) {
  const r = await refreshSession(refreshToken);
  if (!r.ok) return;
  await call('/auth/v1/logout?scope=local', { method: 'POST', token: r.session.accessToken });
}
