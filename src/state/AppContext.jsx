import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { docsGetAll, docPut, docsClearAll, kvGet, kvSet } from '../lib/db';
import { DEFAULT_BADGE_NAMES, DEFAULT_ORG_SETTINGS } from '../lib/seed';
import { DAMAGE_TYPES, carriersForCountry } from '../lib/carriers';
import { hhmm, stamp, docNumber } from '../lib/format';
import { feedback } from '../lib/audio';
import * as api from '../lib/api';
import { resolveTrackings } from '../lib/prepCenter';
import { groupForDdt } from '../lib/ddtGrouping';
import { checkForUpdate, openDownload } from '../lib/updateCheck';

const AppCtx = createContext(null);

// DEFAULT_BASE_URL / DEFAULT_SCANNER_KEYS live in lib/api.js now (so
// api.fetchBadgeCountry can use them without a circular import back into
// this file) — re-exported here under the same names since the rest of
// this file already refers to them by these names throughout.
const { DEFAULT_BASE_URL, DEFAULT_SCANNER_KEYS } = api;
// `apiConfig` (below) is the operator-facing "API" screen connection — a
// separate, optional, external system (e.g. Prep-Center), starting
// unconfigured. It has nothing to do with our own database, which is
// wired up automatically and unconditionally via `internalConfig`
// (derived from the country's badge lock, never user-editable) — see
// that definition for why these two used to be conflated and had to be
// split apart.
const INITIAL_API_CONFIG = { baseUrl: '', apiKey: '', autoPush: true, autoPull: false, keySecured: false };

export function AppProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [shift, setShift] = useState(null);
  const [screen, setScreen] = useState('login');
  const [previousScreen, setPreviousScreen] = useState('home');

  const [direction, setDirection] = useState('in');
  const [carrier, setCarrier] = useState('DHL');
  const [courierCompany, setCourierCompany] = useState('');
  const [shipment, setShipment] = useState('');
  // Where the goods are going. The prep center would name it; without that the
  // operator does, because a delivery note has to say who receives the goods.
  const [destination, setDestination] = useState('');
  const [parcels, setParcels] = useState([]);
  const [sessionStartedAt, setSessionStartedAt] = useState(null);

  const [courierName, setCourierName] = useState('');
  const [plate, setPlate] = useState('');
  const [signatureDataUrl, setSignatureDataUrl] = useState(null);
  const [sigInk, setSigInk] = useState(false);

  const [dupCode, setDupCode] = useState(null);
  const [dupTime, setDupTime] = useState(null);
  const [flash, setFlash] = useState(null); // 'ok' | 'bad' | null

  const [damageSheet, setDamageSheet] = useState({ open: false, picks: [], note: '', photoDataUrl: null });
  const [noCodeSheet, setNoCodeSheet] = useState({ open: false, note: '', photoDataUrl: null });
  // The most recently rejected scan (pattern mismatch), so the UI can offer
  // "log it anyway with a photo" right where the rejection happened —
  // cleared on the next scan attempt of any kind, successful or not.
  const [rejectedScan, setRejectedScan] = useState(null);

  const [toast, setToastState] = useState(null);
  const toastTimer = useRef(null);

  const [confirmedDoc, setConfirmedDoc] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyFilter, setHistoryFilter] = useState('all');
  const [selectedDocNo, setSelectedDocNo] = useState(null);

  const [apiConfig, setApiConfig] = useState(INITIAL_API_CONFIG);
  // Tracking -> the prep center's shipping record, for the open session only.
  // Cleared with the session: a shipment's contents can change between days,
  // and a DDT must describe what is in the boxes leaving today.
  const shipmentCacheRef = useRef(new Map());
  const [apiShowKey, setApiShowKey] = useState(false);
  const [manifest, setManifest] = useState({ codes: [], lastPulledAt: null });
  const [pulling, setPulling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [docSeq, setDocSeq] = useState({ in: 1, out: 1 });
  const [orgSettings, setOrgSettings] = useState(DEFAULT_ORG_SETTINGS);
  const [driverProfiles, setDriverProfiles] = useState([]); // [{ name, courierCompany, plate, lastUsedAt }]
  const [carriers, setCarriers] = useState([]); // [{ name, pattern, country }] — pattern is a required tracking-code prefix, or null
  const [badgeCountries, setBadgeCountries] = useState({}); // { [badgeId]: 'IT' | 'FR' | 'DE' }
  const [loginEvents, setLoginEvents] = useState([]); // [{ badgeId, operatorName, country, ip, loggedInAtIso }]
  const [pullingLoginEvents, setPullingLoginEvents] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState(null);
  const [updateInfo, setUpdateInfo] = useState(null); // { available, versionName, apkUrl } | null
  const [updateDismissed, setUpdateDismissed] = useState(false);

  const [now, setNow] = useState(Date.now());

  const inputRef = useRef(null);

  // ---- clock / elapsed timer ----
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ---- initial load ----
  useEffect(() => {
    (async () => {
      const [savedShift, savedApi, savedManifest, savedSeq, savedOrg, docs, docSeqReset, historyWiped, savedDriverProfiles, savedBadgeCountries, driverProfilesCountryTagged, savedCarriers] = await Promise.all([
        kvGet('shift', null),
        kvGet('apiConfig', INITIAL_API_CONFIG),
        kvGet('manifest', { codes: [], lastPulledAt: null }),
        kvGet('docSeq', { in: 1, out: 1 }),
        kvGet('orgSettings', DEFAULT_ORG_SETTINGS),
        docsGetAll(),
        kvGet('docSeqResetV2', false),
        kvGet('historyWipeV1', false),
        kvGet('driverProfiles', []),
        kvGet('badgeCountries', {}),
        kvGet('driverProfilesCountryTaggedV1', false),
        kvGet('carriers', []),
      ]);
      // One-time reset of the document counter to start numbering at 1
      // (WH-IN-000001 / WH-OUT-000001) — installs from before this change
      // had it at 0 or the old 240/241 seed; new installs already default
      // to 1 above, so this is a no-op for them.
      let seqToUse = savedSeq;
      if (!docSeqReset) {
        seqToUse = { in: 1, out: 1 };
        await kvSet('docSeq', seqToUse);
        await kvSet('docSeqResetV2', true);
      }
      // One-time wipe of any demo/seed documents from earlier builds, so
      // every install — including ones already on a phone — ends up with a
      // clean, empty History/Docs list. New installs never seed demo data
      // any more, so this only ever does something once, on upgrade.
      let docList = docs;
      if (!historyWiped) {
        await docsClearAll();
        docList = [];
        await kvSet('historyWipeV1', true);
      }
      const manifestState = savedManifest;
      const savedBadgeNames = (await kvGet('badgeNames', {})) || {};
      const mergedBadgeNames = { ...DEFAULT_BADGE_NAMES, ...savedBadgeNames };
      await kvSet('badgeNames', mergedBadgeNames);
      setHistory(docList.slice().sort((a, b) => (a.closedAtIso < b.closedAtIso ? 1 : -1)));
      // One-time repair for a real bug: the masked display value (with •
      // bullet characters) could get written back as the actual key, which
      // then made every request throw ("non ISO-8859-1 code point") since
      // HTTP headers can't carry those characters at all. Detect and clear
      // it rather than leaving everyone silently stuck re-sending a broken
      // key forever.
      let apiToUse = /[^ -ÿ]/.test(savedApi.apiKey || '')
        ? { ...savedApi, apiKey: '', keySecured: false }
        : savedApi;
      // One-time migration: `apiConfig` used to double as our own database
      // connection too, force-reset to DEFAULT_BASE_URL + the country's
      // scanner key on every login. An upgrading install's saved value is
      // therefore just that internal value reflected back, not a real
      // Prep-Center connection anyone actually configured — leaving it in
      // place would silently double-post every session to our own database
      // a second time, under this now-separate pipeline. Clear it once; a
      // genuine external connection is typed into Settings going forward.
      const prepSplit = await kvGet('prepConfigSplitV1', false);
      if (!prepSplit) {
        if (apiToUse.baseUrl === DEFAULT_BASE_URL) {
          apiToUse = { ...apiToUse, baseUrl: '', apiKey: '', keySecured: false };
        }
        await kvSet('prepConfigSplitV1', true);
      }
      setApiConfig(apiToUse);
      setManifest(manifestState);
      setDocSeq(seqToUse);
      setOrgSettings({ ...DEFAULT_ORG_SETTINGS, ...savedOrg });
      // One-time wipe of driver profiles saved before they carried a
      // `country` tag — left untagged, they'd silently fail the new
      // per-country filter and vanish from the picker forever instead of
      // just being re-pulled fresh for whichever country is active below.
      let driverProfilesToUse = savedDriverProfiles;
      if (!driverProfilesCountryTagged) {
        driverProfilesToUse = [];
        await kvSet('driverProfilesCountryTaggedV1', true);
      }
      setDriverProfiles(driverProfilesToUse);
      // Catch this phone up with the country's full driver list on every
      // cold start where a connection already exists — a fresh install (no
      // local drivers at all yet) or a device that's been offline for a
      // while both need this, not just a brand-new badge login.
      // These three always talk to our own database, never whatever's typed
      // into the (now fully separate) Prep-Center connection above — built
      // straight from the country's own scanner key, not `apiToUse`.
      const savedInternalKey = savedShift?.country && DEFAULT_SCANNER_KEYS[savedShift.country];
      const savedInternalConfig = savedInternalKey ? { baseUrl: DEFAULT_BASE_URL, apiKey: savedInternalKey } : null;
      if (savedInternalConfig && savedShift?.country) pullDriverProfilesNowRef.current(savedInternalConfig, savedShift.country);
      setCarriers(savedCarriers);
      if (savedInternalConfig && savedShift?.country) pullCarriersNowRef.current(savedInternalConfig, savedShift.country);
      if (savedInternalConfig && savedShift?.country) pullHistoryNowRef.current(savedInternalConfig, savedShift.country);
      setBadgeCountries(savedBadgeCountries);
      if (savedShift) {
        setShift(savedShift);
        setScreen('home');
      }
      setReady(true);
    })();
  }, []);

  // Wired up automatically from the country's badge lock — never
  // user-editable, and immune to whatever's typed into the separate
  // Prep-Center connection (`apiConfig`) below. This is what every
  // internal operation (doc numbering, our own session save, driver/
  // carrier/damage sync, history pull) talks to.
  const internalConfig = useMemo(() => {
    const key = shift?.country && DEFAULT_SCANNER_KEYS[shift.country];
    return key ? { baseUrl: DEFAULT_BASE_URL, apiKey: key } : null;
  }, [shift?.country]);

  useEffect(() => { if (ready) kvSet('apiConfig', apiConfig); }, [ready, apiConfig]);
  useEffect(() => { if (ready) kvSet('manifest', manifest); }, [ready, manifest]);
  useEffect(() => { if (ready) kvSet('docSeq', docSeq); }, [ready, docSeq]);
  useEffect(() => { if (ready && shift) kvSet('shift', shift); }, [ready, shift]);
  useEffect(() => { if (ready) kvSet('orgSettings', orgSettings); }, [ready, orgSettings]);
  useEffect(() => { if (ready) kvSet('driverProfiles', driverProfiles); }, [ready, driverProfiles]);
  useEffect(() => { if (ready) kvSet('badgeCountries', badgeCountries); }, [ready, badgeCountries]);
  useEffect(() => { if (ready) kvSet('carriers', carriers); }, [ready, carriers]);

  // ---- update check (once per app open) ----
  useEffect(() => {
    if (!ready) return;
    checkForUpdate().then((res) => { if (res.available) setUpdateInfo(res); });
  }, [ready]);
  const checkUpdateNow = useCallback(async () => {
    const res = await checkForUpdate();
    setUpdateInfo(res.available ? res : null);
    return res;
  }, []);
  const dismissUpdate = useCallback(() => setUpdateDismissed(true), []);
  const downloadUpdate = useCallback(() => { if (updateInfo?.apkUrl) openDownload(updateInfo.apkUrl); }, [updateInfo]);

  const showToast = useCallback((msg) => {
    setToastState(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastState(null), 2600);
  }, []);

  // ---- navigation ----
  const canGoBack = ['setup', 'scan', 'sign', 'doc', 'session', 'settings'].includes(screen);
  const goBack = useCallback(() => {
    setScreen((s) => {
      if (s === 'setup') return 'home';
      if (s === 'scan') return 'setup';
      if (s === 'sign') return 'scan';
      if (s === 'session') return 'history';
      if (s === 'settings') return 'home';
      if (s === 'doc') return previousScreen === 'confirm' ? 'confirm' : 'home';
      return 'home';
    });
  }, [previousScreen]);
  const goHome = useCallback(() => setScreen('home'), []);
  const goToHistoryTab = useCallback(() => setScreen('history'), []);
  const goToDocsTab = useCallback(() => { setPreviousScreen(screen); setScreen('doc'); }, [screen]);
  const goToApiTab = useCallback(() => setScreen('api'), []);
  const goToSettings = useCallback(() => setScreen('settings'), []);

  // ---- shift / badge login ----
  // Wires the app up to its own database for this country, with no setup
  // from the operator — the visible API screen is a separate, optional
  // Prep-Center connection and is never touched here.
  const applyCountryConnection = useCallback((countryCode) => {
    const key = DEFAULT_SCANNER_KEYS[countryCode];
    if (!key) return;
    pullDriverProfilesNowRef.current({ baseUrl: DEFAULT_BASE_URL, apiKey: key }, countryCode);
    pullCarriersNowRef.current({ baseUrl: DEFAULT_BASE_URL, apiKey: key }, countryCode);
    pullHistoryNowRef.current({ baseUrl: DEFAULT_BASE_URL, apiKey: key }, countryCode);
    // Cosmetic, but avoids a stale "next document" preview number carried
    // over from whichever country was last active on this device — the
    // real, authoritative number always comes from the server reservation
    // when online; this only ever shows up in the rare offline-fallback
    // path, but should still read as "this country starts clean".
    setDocSeq({ in: 1, out: 1 });
  }, []);
  // Country is no longer something the operator picks — it's a fact of the
  // badge, looked up server-side on every login (admin.badge_countries).
  // `badgeCountries` stays as a local read-through cache, keyed by badge id:
  // a country code once confirmed, or `null` for "confirmed unassigned as of
  // last check" (distinct from "never checked", i.e. the key absent
  // entirely) — that distinction lets an offline retry of a never-assigned
  // badge still show "contact the office" instead of "no connection".
  // Returns { ok: true } on success, or { ok: false, reason: 'unassigned' |
  // 'offline' } so BadgeLogin can render the right blocking message —
  // deliberately never navigates to 'home' except on a real, live-confirmed
  // (or offline-with-prior-confirmation) success, since the whole point of
  // this change is an authoritative check, not an optimistic guess.
  // Badge login is scan-only end to end — the operator's name is never
  // typed in here, only ever resolved from the badge's own server-side
  // registration (admin.badge_countries.label), with the local cache below
  // as an offline fallback for a badge seen before.
  const loginWithBadge = useCallback(async (badgeId) => {
    const id = badgeId || 'BADGE-0000';
    const hasCached = Object.prototype.hasOwnProperty.call(badgeCountries, id);
    const cachedCountry = badgeCountries[id];
    const res = await api.fetchBadgeCountry(id);
    let country;
    let operatorName;
    if (res.ok) {
      country = res.country;
      setBadgeCountries((c) => ({ ...c, [id]: country }));
      const knownNames = (await kvGet('badgeNames', {})) || {};
      operatorName = res.label || knownNames[id] || 'Operator';
      if (res.label && knownNames[id] !== res.label) {
        await kvSet('badgeNames', { ...knownNames, [id]: res.label });
      }
    } else if (res.notFound) {
      setBadgeCountries((c) => ({ ...c, [id]: null }));
      return { ok: false, reason: 'unassigned' };
    } else if (hasCached && cachedCountry) {
      // Couldn't reach the server, but this badge's country was confirmed
      // before — proceed offline rather than blocking someone mid-shift
      // over a transient network blip. Name comes from whatever was
      // cached the last time this badge's label was actually resolved.
      country = cachedCountry;
      const knownNames = (await kvGet('badgeNames', {})) || {};
      operatorName = knownNames[id] || 'Operator';
    } else if (hasCached && cachedCountry === null) {
      return { ok: false, reason: 'unassigned' };
    } else {
      return { ok: false, reason: 'offline' };
    }
    const s = { badgeId: id, operatorName, startedAt: Date.now(), country };
    setShift(s);
    setScreen('home');
    applyCountryConnection(country);
    pullManifestNowRef.current({ silent: true });
    // Audit trail only — never blocks or fails an actual login.
    const key = DEFAULT_SCANNER_KEYS[country];
    if (key) {
      api.recordLoginEvent({ baseUrl: DEFAULT_BASE_URL, apiKey: key }, { badgeId: id, operatorName, country }).catch(() => {});
    }
    return { ok: true };
  }, [badgeCountries, applyCountryConnection]);
  const endShift = useCallback(() => {
    setShift(null);
    kvSet('shift', null);
    setScreen('login');
  }, []);

  // Login is permanent by design — the operator stays signed in until they
  // tap "End shift" themselves (previously auto-logged-out after 5 minutes
  // of inactivity, which was more disruptive than useful on a warehouse
  // floor where a phone can sit idle between scans for longer than that).
  const updateOperatorName = useCallback(async (name) => {
    const trimmed = name.trim();
    if (!trimmed || !shift) return;
    setShift((s) => ({ ...s, operatorName: trimmed }));
    const knownNames = (await kvGet('badgeNames', {})) || {};
    knownNames[shift.badgeId] = trimmed;
    await kvSet('badgeNames', knownNames);
  }, [shift]);

  // ---- org / warehouse / company settings ----
  const updateOrgSettings = useCallback((partial) => {
    setOrgSettings((s) => ({ ...s, ...partial }));
  }, []);

  // ---- photo viewer (damage attachments) ----
  const openPhoto = useCallback((url) => setViewingPhoto(url), []);
  const closePhoto = useCallback(() => setViewingPhoto(null), []);

  // ---- session setup ----
  // Tapping Inbound/Outbound on Home resumes an already-open session in
  // that same direction (there's no separate "Scan" tab any more — this is
  // the only way back in) rather than silently discarding scanned parcels.
  // Switching direction mid-session is blocked rather than wiping it.
  const startSession = useCallback((dir) => {
    const sessionOpen = parcels.length > 0 || screen === 'setup' || screen === 'scan' || screen === 'sign';
    if (sessionOpen && direction === dir) {
      setScreen(parcels.length ? 'scan' : 'setup');
      return;
    }
    if (sessionOpen && direction !== dir) {
      showToast(`Finish the open ${direction === 'in' ? 'inbound' : 'outbound'} session first`);
      return;
    }
    setDirection(dir);
    setParcels([]);
    shipmentCacheRef.current.clear();
    setConfirmedDoc(null);
    setSignatureDataUrl(null);
    setSigInk(false);
    setCourierName('');
    setCourierCompany('');
    setPlate('');
    setShipment('');
    setDestination('');
    setSessionStartedAt(Date.now());
    setScreen('setup');
  }, [parcels.length, screen, direction, showToast]);
  const toScan = useCallback(() => { setSessionStartedAt(Date.now()); setScreen('scan'); }, []);

  // ---- outbound: which shipment does this box belong to? ----
  // A DDT is built per shipment, so an outbound scan has to be placed against
  // the prep center's shipping record. One shipment can hold ~200 trackings and
  // an operator may scan dozens of them, so the answer is cached per shipment
  // for the session: 40 boxes of one shipment cost one call, not 40.
  //
  // Deliberately fire-and-forget. Scanning is the one thing in this app that
  // must never wait on a network — the parcel is recorded first and patched
  // when (or if) the answer arrives; a parcel left `pending` is resolved again
  // at sync time rather than blocking the operator at the loading bay.
  const apiConfigRef = useRef(apiConfig);
  useEffect(() => { apiConfigRef.current = apiConfig; }, [apiConfig]);

  // Update one stored document, in state and in storage, applying only the
  // fields being changed.
  //
  // Two sync passes run back to back over the same session — ours, then the
  // Prep-Center one — and each used to write back the whole document it had
  // closed over at the start. The second pass therefore undid what the first
  // had just written. That is how a session could have its delivery notes
  // issued a second time on the next sync, burning numbers out of a legal
  // series. The ref is updated before the await so the second pass reads the
  // first pass's result rather than the copy it started with.
  const historyRef = useRef([]);
  useEffect(() => { historyRef.current = history; }, [history]);

  const patchDocument = useCallback(async (docNo, country, patch) => {
    const list = historyRef.current;
    const idx = list.findIndex((x) => x.doc === docNo && x.country === country);
    const base = idx === -1 ? null : list[idx];
    const merged = { ...(base || {}), ...patch };
    if (idx !== -1) {
      const next = list.slice();
      next[idx] = merged;
      historyRef.current = next;
    }
    await docPut(merged);
    setHistory((h) => h.map((x) => (x.doc === docNo && x.country === country ? { ...x, ...patch } : x)));
    return merged;
  }, []);

  const patchParcel = useCallback((code, patch) => {
    setParcels((list) => list.map((p) => (p.code === code ? { ...p, ...patch } : p)));
  }, []);

  const applyShipment = useCallback((code, shipment) => {
    const boxInfo = shipment?.byTracking?.get(code) || null;
    patchParcel(code, {
      shipmentId: shipment.shipmentId,
      fbaId: shipment.fbaId || null,
      weightKg: boxInfo?.weightKg ?? null,
      contents: boxInfo?.contents || [],
      shipmentStatus: 'ok',
      shipmentError: null,
    });
  }, [patchParcel]);

  const resolveShipmentForCode = useCallback(async (code) => {
    const cached = shipmentCacheRef.current.get(code);
    if (cached) { applyShipment(code, cached); return; }
    const config = apiConfigRef.current;
    if (!config?.baseUrl) {
      // Not configured is not a reason to undo a reference the operator gave.
      setParcels((list) => list.map((p) => (
        p.code !== code || p.shipmentStatus === 'manual' ? p : {
          ...p, shipmentStatus: 'pending', shipmentError: 'Prep-Center not configured',
        }
      )));
      return;
    }
    const res = await resolveTrackings(config, [code]);
    const shipment = res.shipments.get(code);
    if (shipment) {
      for (const t of shipment.byTracking.keys()) shipmentCacheRef.current.set(t, shipment);
      applyShipment(code, shipment);
      return;
    }
    // Two different failures that must not be confused. `unknown` means the
    // prep center answered and has never heard of this label — it cannot go on
    // a DDT. `pending` means we could not ask; it is resolved later.
    setParcels((list) => list.map((p) => (
      p.code !== code || p.shipmentStatus === 'manual' ? p : {
        ...p,
        shipmentStatus: res.ok ? 'unknown' : 'pending',
        shipmentError: res.ok ? 'Not found in Prep-Center' : res.error || 'Prep-Center unreachable',
      }
    )));
  }, [applyShipment, patchParcel]);

  // ---- scanning ----
  const accept = useCallback((code) => {
    // The Prep-Center's manifest lists outbound cartons only — parcels leaving,
    // with a shipping behind them. It used to list inbound receipts, and the
    // moment it changed, checking an arriving parcel against it would have
    // marked every single inbound scan "Not on manifest". An expectation list
    // for goods it is not about is worse than no list: it cries wolf on every
    // box, and an operator who learns to ignore the badge will ignore it on the
    // day it is right. So it applies to outbound, and inbound shows no badge.
    const expected = direction === 'out' && apiConfig.autoPull && manifest.codes.length
      ? manifest.codes.includes(code)
      : null;
    feedback(false);
    // Which shipping this box belongs to is the one fact a delivery note cannot
    // do without, and the prep center's API does not expose it — its only route
    // returns a bare list of tracking numbers. So the operator supplies it:
    // whatever reference is set on the scan screen is stamped on each box as it
    // is scanned, and changing it mid-session starts a new delivery note. If the
    // prep center is ever able to answer, its reply overwrites this with the
    // richer record; until then this is what makes the document possible at all.
    const ref = (shipment || '').trim().toUpperCase();
    setParcels((p) => p.concat([{
      code, carrier, boxes: 1, time: hhmm(), damage: null, photo: null, expected,
      ...(direction === 'out' && ref
        ? { shipmentId: ref, fbaId: ref, shipmentStatus: 'manual', shipmentError: null }
        : {}),
    }]));
    setFlash('ok');
    setTimeout(() => setFlash((f) => (f === 'ok' ? null : f)), 700);
    if (direction === 'out') resolveShipmentForCode(code);
  }, [apiConfig.autoPull, manifest.codes, carrier, direction, shipment, resolveShipmentForCode]);

  const submitScan = useCallback((raw) => {
    const code = String(raw || '').trim().toUpperCase();
    if (!code) return;
    // Cleared on every attempt — a mismatch banner from a previous scan
    // shouldn't linger once the operator has moved on to a new one.
    setRejectedScan(null);
    // A carrier can require its tracking codes to start with a specific
    // prefix (e.g. UPS -> "1Z") to catch a wrong/stray scan before it ever
    // enters the session — checked before the duplicate check so a bad
    // code is rejected outright rather than compared against what's
    // already been scanned. The operator isn't stuck, though: the code
    // stays visible with a "log it anyway" escape hatch (photo required)
    // for a genuinely legitimate case — wrong carrier selected, damaged
    // label — without making the override an effortless one-tap bypass.
    const carrierRule = carriers.find((c) => c.name.toLowerCase() === carrier.toLowerCase());
    if (carrierRule?.pattern && !code.startsWith(carrierRule.pattern)) {
      feedback(true);
      setFlash('bad');
      const reason = `must start with "${carrierRule.pattern}"`;
      showToast(`Invalid code for ${carrier} — ${reason}`);
      setRejectedScan({ code, reason });
      return;
    }
    const dup = parcels.find((p) => p.code === code);
    if (dup) {
      feedback(true);
      setDupCode(code);
      setDupTime(dup.time);
      setFlash('bad');
      return;
    }
    accept(code);
  }, [parcels, accept, carriers, carrier, showToast]);

  const closeDup = useCallback(() => { setDupCode(null); setFlash(null); }, []);
  const dupAddBox = useCallback(() => {
    setParcels((arr) => arr.map((x) => (x.code === dupCode ? { ...x, boxes: x.boxes + 1 } : x)));
    setDupCode(null);
    setFlash(null);
  }, [dupCode]);

  const boxPlus = useCallback(() => {
    setParcels((arr) => {
      if (!arr.length) return arr;
      const a = arr.slice();
      a[a.length - 1] = { ...a[a.length - 1], boxes: a[a.length - 1].boxes + 1 };
      return a;
    });
  }, []);
  const boxMinus = useCallback(() => {
    setParcels((arr) => {
      if (!arr.length || arr[arr.length - 1].boxes <= 1) return arr;
      const a = arr.slice();
      a[a.length - 1] = { ...a[a.length - 1], boxes: a[a.length - 1].boxes - 1 };
      return a;
    });
  }, []);
  const removeLast = useCallback(() => {
    if (!parcels.length) return;
    showToast('Last scan removed');
    setParcels((arr) => arr.slice(0, -1));
  }, [parcels.length, showToast]);
  // Removes any single parcel from the session list, not just the last
  // one — tracking codes are unique within a session (duplicates are
  // merged into "+1 box" elsewhere), so the code is a safe key to delete by.
  const removeParcel = useCallback((code) => {
    setParcels((arr) => arr.filter((p) => p.code !== code));
    showToast(`${code} removed`);
  }, [showToast]);

  // ---- damage sheet ----
  const openDamage = useCallback(() => {
    if (!parcels.length) { showToast('Scan a parcel first'); return; }
    setDamageSheet({ open: true, picks: [], note: '', photoDataUrl: null });
  }, [parcels.length, showToast]);
  const closeDamage = useCallback(() => setDamageSheet((d) => ({ ...d, open: false })), []);
  const toggleDamageType = useCallback((type) => {
    setDamageSheet((d) => ({ ...d, picks: d.picks.includes(type) ? d.picks.filter((x) => x !== type) : d.picks.concat([type]) }));
  }, []);
  const setDamageNote = useCallback((note) => setDamageSheet((d) => ({ ...d, note })), []);
  const setDamagePhoto = useCallback((dataUrl) => setDamageSheet((d) => ({ ...d, photoDataUrl: dataUrl })), []);
  const saveDamage = useCallback(() => {
    if (!damageSheet.picks.length || !damageSheet.photoDataUrl) {
      showToast('Pick a damage type and take a photo');
      return;
    }
    const label = damageSheet.picks.join(', ') + (damageSheet.note ? ' — ' + damageSheet.note : '');
    const photoName = `IMG_${docSeq[direction]}_${parcels.length}.jpg`;
    const trackingCode = parcels.length ? parcels[parcels.length - 1].code : null;
    setParcels((arr) => {
      if (!arr.length) return arr;
      const a = arr.slice();
      a[a.length - 1] = { ...a[a.length - 1], damage: label, photo: photoName, photoDataUrl: damageSheet.photoDataUrl };
      return a;
    });
    setDamageSheet({ open: false, picks: [], note: '', photoDataUrl: null });

    if (internalConfig && trackingCode) {
      api.pushDamage(internalConfig, trackingCode, {
        tracking: trackingCode,
        type: label,
        photo: damageSheet.photoDataUrl,
        recorded_at: new Date().toISOString(),
      }).then((res) => {
        if (!res.ok) showToast(`Damage push failed for ${trackingCode} — will still go out with the session`);
      });
    }
  }, [damageSheet, docSeq, direction, parcels, internalConfig, showToast]);

  // ---- "no valid code" sheet — for a parcel that physically arrived but
  // has no usable tracking code (unreadable/damaged label, or one that
  // doesn't match the carrier's required prefix). Creates a brand new
  // parcel with a generated placeholder code, rather than attaching to an
  // existing one the way saveDamage does — there's nothing to attach to
  // when the whole point is that no code could be read. A photo is
  // required, same as damage, so this can't become an effortless way to
  // skip the carrier-pattern check. `prefill` seeds the note when opened
  // right after a rejected scan, so the original (bad) code and reason
  // aren't lost. ----
  const openNoCodeSheet = useCallback((prefill = '') => {
    setNoCodeSheet({ open: true, note: prefill, photoDataUrl: null });
  }, []);
  const closeNoCodeSheet = useCallback(() => setNoCodeSheet((s) => ({ ...s, open: false })), []);
  const setNoCodeNote = useCallback((note) => setNoCodeSheet((s) => ({ ...s, note })), []);
  const setNoCodePhoto = useCallback((dataUrl) => setNoCodeSheet((s) => ({ ...s, photoDataUrl: dataUrl })), []);
  const saveNoCode = useCallback(() => {
    if (!noCodeSheet.photoDataUrl) { showToast('Take a photo first'); return; }
    // A placeholder unique within this session — NOCODE-1, NOCODE-2, … —
    // so it still has a "code" to key off everywhere the rest of the app
    // (dedup, the parcel list, the printed document) expects one.
    const existing = parcels.filter((p) => p.noCode).length;
    const code = `NOCODE-${existing + 1}`;
    const photoName = `IMG_${docSeq[direction]}_${parcels.length}_nocode.jpg`;
    setParcels((p) => p.concat([{
      code, carrier, boxes: 1, time: hhmm(), damage: null, photo: null, expected: null,
      noCode: true, noCodeNote: noCodeSheet.note || null, noCodePhoto: photoName, noCodePhotoDataUrl: noCodeSheet.photoDataUrl,
    }]));
    setFlash('ok');
    setTimeout(() => setFlash((f) => (f === 'ok' ? null : f)), 700);
    setRejectedScan(null);
    setNoCodeSheet({ open: false, note: '', photoDataUrl: null });
    showToast(`${code} logged with photo — flag it for the office`);
  }, [noCodeSheet, parcels, carrier, docSeq, direction, showToast]);

  // ---- signature ----
  const toSign = useCallback(() => {
    if (!parcels.length) { showToast('Nothing scanned yet'); return; }
    setScreen('sign');
  }, [parcels.length, showToast]);
  const clearSignature = useCallback(() => { setSignatureDataUrl(null); setSigInk(false); }, []);

  // No separate driver-acknowledgment checkbox — the operator's own scan of
  // every parcel already is the confirmation, so requiring a second manual
  // tick on top of that was redundant.
  const signReady = courierName.trim().length > 1 && sigInk;

  // Closing a session is not instantaneous: it reserves a document number over
  // the network, renders the PDF, builds the delivery notes and pushes them.
  // For those few hundred milliseconds the parcel list is still full and the
  // button still looks tappable, so a second tap — an impatient operator, a
  // double-tap on a laggy handheld — used to start the whole flow a second
  // time and record the same goods under a second document number. (It really
  // happened: three outbound documents, same nineteen trackings, one second
  // apart.) The ref is what actually blocks it; the state only drives the
  // button, and state updates arrive too late to stop the second tap.
  const finishingRef = useRef(false);
  const [finishing, setFinishing] = useState(false);

  // ---- driver profiles (remembered so the office doesn't retype the same
  // driver/plate every time that person shows up again) — kept in this
  // country's own database, not just on this one phone, so the same driver
  // list is there after a reinstall and shows up the same way on any other
  // device logged into this country. ----
  const saveDriverProfile = useCallback((name, company, plateNo) => {
    const trimmedName = (name || '').trim();
    if (!trimmedName) return;
    const key = trimmedName.toLowerCase();
    const updated = { name: trimmedName, courierCompany: (company || '').trim(), plate: (plateNo || '').trim(), lastUsedAt: Date.now(), country: shift?.country || null };
    setDriverProfiles((list) => {
      const others = list.filter((p) => p.name.toLowerCase() !== key);
      return [updated, ...others].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    });
    if (internalConfig) api.pushDriverProfile(internalConfig, updated).catch(() => {});
  }, [internalConfig, shift]);
  // Pulls this country's driver list from the database and merges it with
  // whatever's local (by name, keeping whichever copy was touched more
  // recently) — called on login and whenever the country connection is
  // (re)established, so a fresh install or a different phone catches up
  // with every driver already known to this warehouse. `countryCode` is
  // passed explicitly by every caller (rather than read from `shift` here)
  // so this stays safe to call before `shift` itself has been updated yet.
  const pullDriverProfilesNow = useCallback(async (config, countryCode) => {
    if (!config?.apiKey) return;
    const res = await api.fetchDriverProfiles(config);
    if (!res.ok) return;
    setDriverProfiles((list) => {
      const byName = new Map(list.map((p) => [p.name.toLowerCase(), p]));
      for (const remote of res.drivers) {
        const key = remote.name.toLowerCase();
        const local = byName.get(key);
        const remoteTime = new Date(remote.lastUsedAt).getTime() || 0;
        if (!local || remoteTime > (local.lastUsedAt || 0)) byName.set(key, { ...remote, lastUsedAt: remoteTime, country: countryCode });
      }
      return Array.from(byName.values()).sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    });
  }, []);
  const pullDriverProfilesNowRef = useRef(() => {});
  useEffect(() => { pullDriverProfilesNowRef.current = pullDriverProfilesNow; }, [pullDriverProfilesNow]);
  const applyDriverProfile = useCallback((profile) => {
    setCourierName(profile.name);
    setCourierCompany(profile.courierCompany || '');
    setPlate(profile.plate || '');
  }, []);

  // ---- carriers (per-country list + optional tracking-code prefix rule)
  // — same server-backed, database-of-record pattern as driver profiles. ----
  const saveCarrier = useCallback((name, pattern) => {
    const trimmedName = (name || '').trim();
    if (!trimmedName) return;
    const key = trimmedName.toLowerCase();
    const normalizedPattern = (pattern || '').trim().toUpperCase() || null;
    const updated = { name: trimmedName, pattern: normalizedPattern, country: shift?.country || null };
    setCarriers((list) => {
      const others = list.filter((c) => c.name.toLowerCase() !== key);
      return [...others, updated].sort((a, b) => a.name.localeCompare(b.name));
    });
    if (internalConfig) api.pushCarrier(internalConfig, updated).catch(() => {});
  }, [internalConfig, shift]);
  const pullCarriersNow = useCallback(async (config, countryCode) => {
    if (!config?.apiKey) return;
    const res = await api.fetchCarriers(config);
    if (!res.ok) return;
    setCarriers((list) => {
      const byName = new Map(list.map((c) => [c.name.toLowerCase(), c]));
      for (const remote of res.carriers) byName.set(remote.name.toLowerCase(), { ...remote, country: countryCode });
      return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
    });
  }, []);
  const pullCarriersNowRef = useRef(() => {});
  useEffect(() => { pullCarriersNowRef.current = pullCarriersNow; }, [pullCarriersNow]);

  // ---- shared session history — every device logged into this country
  // sees the same list, not just what it personally created, and the doc
  // numbers on screen are visibly the real country-wide progressive
  // sequence. Only ever ADDS sessions this device doesn't already have
  // locally (by doc) — a doc this device itself created keeps its richer
  // local copy (real signature/photos) rather than being replaced by the
  // lean server summary. ----
  const pullHistoryNow = useCallback(async (config, countryCode) => {
    if (!config?.apiKey) return;
    const res = await api.fetchSessions(config);
    if (!res.ok) return;
    // Dedupe inside the updater itself (always sees the latest state, not
    // whatever `history` this closure happened to capture) — at cold start
    // this function can fire before the ref that keeps it fresh has
    // caught up with the just-loaded local history, which otherwise
    // treated already-pulled remote sessions as new again on every reload.
    setHistory((h) => {
      const known = new Set(h.filter((x) => x.country === countryCode).map((x) => x.doc));
      const additions = [];
      for (const remote of res.sessions) {
        if (known.has(remote.doc)) continue;
        const closedDate = new Date(remote.closedAtIso);
        additions.push({
          ...remote,
          country: countryCode,
          syncStatus: 'ok',
          date: stamp(closedDate),
          parcels: remote.parcels.map((p) => ({ ...p, time: p.createdAtIso ? hhmm(new Date(p.createdAtIso)) : '' })),
        });
      }
      if (!additions.length) return h;
      additions.forEach((doc) => { docPut(doc); });
      return [...additions, ...h].sort((a, b) => (a.closedAtIso < b.closedAtIso ? 1 : -1));
    });
  }, []);
  const pullHistoryNowRef = useRef(() => {});
  useEffect(() => { pullHistoryNowRef.current = pullHistoryNow; }, [pullHistoryNow]);

  // Renders the exact same A4 handover PDF the app can print/share, as a
  // base64 data URL, to attach to the outgoing session payload — so the ERP
  // gets the real document instead of having to re-derive its own from the
  // structured fields. Non-fatal: the session still sends without it if
  // rendering fails for some reason.
  // Build the outbound delivery notes for a signed session: one per shipment,
  // each listing only the trackings scanned in this session. The same signature
  // and driver details go on every one — the driver signed for the whole
  // handover, whichever shipments it happened to span.
  //
  // Anything the prep center could not place is deliberately left out and
  // reported instead. A tracking on a DDT that the shipping record does not
  // recognise would be a false statement on a legal transport document.
  const buildDdtsForSession = useCallback(async (document) => {
    if (document.direction !== 'out') return { ddts: [], excluded: [] };
    const parcels = document.parcels || [];

    // Catch up on anything still unplaced before deciding what goes on a DDT.
    //
    // The lookup during scanning is fire-and-forget, so the last box scanned can
    // still be in flight when the driver signs — and without this it would be
    // dropped from the document a second before its answer arrived. Offline, it
    // is every box: this is also what lets a session scanned with no signal
    // produce its delivery notes later, from syncNow.
    //
    // One call for all of them, and it runs after the signature, so it never
    // stands between the operator and the next scan.
    const shipmentByCode = new Map();
    for (const p of parcels) {
      const cached = shipmentCacheRef.current.get(p.code);
      if (cached) shipmentByCode.set(p.code, cached);
    }
    // A typed reference is a fallback, not a verdict. It was never meant to
    // stop the prep center from answering — it exists for when it cannot. Left
    // out of this catch-up, a box the operator labelled by hand could never
    // pick up the real shipping record, so its delivery note went out with no
    // destination address, no weights and no itemised contents: exactly the
    // fields the typed reference cannot supply. A real answer replaces it; a
    // failure leaves it untouched, which is what the guards below do.
    const outstanding = parcels
      .filter((p) => p.shipmentStatus !== 'ok' && !shipmentByCode.has(p.code))
      .map((p) => p.code);
    // The catch-up's own outcome is the freshest word on the boxes it covered —
    // more recent than whatever they were marked with while scanning.
    let catchUp = null;
    if (outstanding.length && apiConfigRef.current?.baseUrl) {
      catchUp = await resolveTrackings(apiConfigRef.current, outstanding);
      for (const [code, shipment] of catchUp.shipments) {
        shipmentByCode.set(code, shipment);
        shipmentCacheRef.current.set(code, shipment);
      }
    }
    const wasAskedAgain = new Set(outstanding);

    const resolved = parcels.map((p) => {
      const shipment = shipmentByCode.get(p.code);
      if (!shipment) {
        // groupForDdt keys on shipmentId; a parcel the prep center rejected
        // outright must not be grouped even if a stale id is still on it.
        const recheck = catchUp && wasAskedAgain.has(p.code);
        return {
          ...p,
          shipmentId: p.shipmentStatus === 'ok' || p.shipmentStatus === 'manual' ? p.shipmentId : null,
          shipmentStatus: recheck && p.shipmentStatus !== 'manual'
            ? (catchUp.ok ? 'unknown' : 'pending') : p.shipmentStatus,
          shipmentError: recheck && p.shipmentStatus !== 'manual'
            ? (catchUp.ok ? 'Not found in Prep-Center' : catchUp.error) : p.shipmentError,
        };
      }
      const box = shipment.byTracking?.get(p.code);
      return {
        ...p,
        shipmentId: shipment.shipmentId,
        fbaId: shipment.fbaId || p.fbaId || null,
        weightKg: p.weightKg ?? box?.weightKg ?? null,
        contents: (p.contents || []).length ? p.contents : box?.contents || [],
      };
    });

    const { groups, unresolved } = groupForDdt(resolved);
    if (!groups.length) return { ddts: [], excluded: unresolved };

    const mod = await import('../lib/ddtPdf');
    const ddts = [];
    for (const group of groups) {
      const shipment = shipmentByCode.get(group.parcels[0].code) || {};
      // Each DDT takes its own number from the DDT series. Reserved
      // server-side like every other document number; if that call fails the
      // document is still produced, marked so the office can see the number
      // was not the database's.
      let number = null;
      if (internalConfig) {
        const res = await api.reserveDdtNumber(internalConfig);
        if (res.ok) number = res.document;
      }
      const ddt = {
        ...group,
        number: number || `DDT (local) ${group.shipmentId}`,
        numberReserved: Boolean(number),
        // A DDT is dated, not timestamped — `document.date` carries the time
        // too ("16/09/2026 · 20:56"), which belongs in the collection field,
        // not in "no. DDT 211-OUT/2026 del ...".
        date: String(document.date || '').split('·')[0].trim(),
        // Our own address is the one party to this document we always know,
        // so it is never left blank waiting on the prep center. A delivery note
        // without a sender is not a delivery note.
        // Split on commas: the address boxes are a third of the page wide and a
        // single long line simply ran across into the next box.
        pickup: (shipment.pickup || []).length ? shipment.pickup : [
          orgSettings.companyName,
          ...String(orgSettings.companyAddress || '').split(',').map((x) => x.trim()).filter(Boolean),
          orgSettings.companyVat,
          orgSettings.companyEmail,
          [orgSettings.warehouseLocation, orgSettings.warehouseDock].filter(Boolean).join(' · ') || null,
        ].filter(Boolean),
        customer: shipment.customer || [],
        destination: (shipment.destination || []).length
          ? shipment.destination
          : (document.destination ? String(document.destination).split(',').map((x) => x.trim()).filter(Boolean) : []),
        carrier: shipment.carrier || document.carrier || null,
        reason: shipment.reason || null,
        goodsDescription: shipment.goodsDescription || 'Box',
        collectionAt: document.date,   // date and time: when the driver took them
        prepAt: shipment.prepAt || null,
        references: [
          shipment.fbaId || group.fbaId ? `Inbound Plan ID: ${shipment.fbaId || group.fbaId}` : null,
          shipment.amazonReference ? `Amazon reference number: ${shipment.amazonReference}` : null,
          // Without itemised contents the trackings are what identifies the
          // goods, so they belong on the document rather than only in our
          // database. With contents, the products table already says it.
          ...(group.parcels.some((p) => (p.contents || []).length)
            ? []
            : group.parcels.map((p, i) => `Package ${i + 1}: ${p.code}`)),
        ].filter(Boolean),
        legalNote: shipment.legalNote || null,
        confirmationLine: shipment.packingGroup ? `Packing group ${shipment.packingGroup}` : null,
        driverName: document.driverName || null,
        driverCompany: document.courierCompany || null,
        driverPlate: document.plate || null,
        signedAt: document.docTime || null,
        signatureDataUrl: document.signatureDataUrl || null,
        // Kept verbatim for the audit trail — see the `fields` column.
        source: shipment.raw || null,
        contentsPerBox: shipment.contentsPerBox !== false,
      };
      let pdfDataUrl = null;
      try { pdfDataUrl = mod.ddtDataUrl(ddt, orgSettings); } catch { pdfDataUrl = null; }
      ddts.push({ ...ddt, pdfDataUrl });
    }
    return { ddts, excluded: unresolved };
  }, [internalConfig, orgSettings]);

  const renderPdfDataUrl = useCallback(async (document) => {
    try {
      const mod = await import('../lib/pdfDoc');
      return mod.buildHandoverPdf(document, orgSettings).output('datauristring');
    } catch {
      return null;
    }
  }, [orgSettings]);

  const closeSession = useCallback(async () => {
    saveDriverProfile(courierName, courierCompany, plate);
    const now2 = new Date();
    // Reserve the real progressive number from the database up front,
    // before the PDF is even rendered — that way the number the operator
    // sees and prints always matches what actually lands in the database,
    // instead of a locally-generated placeholder that could drift (e.g.
    // after a reinstall resets the local counter, or a second device is
    // active on the same country at the same time). Falls back to the old
    // local counter only when there's no connection to reserve from.
    let doc = docNumber(direction, docSeq[direction]);
    if (internalConfig) {
      const reserved = await api.reserveDocNumber(internalConfig, direction === 'out' ? 'outbound' : 'inbound');
      if (reserved.ok) doc = reserved.document;
    }
    const document = {
      doc,
      direction,
      carrier,
      courierCompany,
      shipment,
      destination,
      driverName: courierName,
      plate,
      operator: `${shift?.operatorName || 'Operator'} · ${shift?.badgeId || ''}`,
      operatorBadge: shift?.badgeId || '',
      country: shift?.country || null,
      parcels,
      signatureDataUrl,
      date: stamp(now2),
      docTime: stamp(now2),
      closedAtIso: now2.toISOString(),
      syncStatus: 'pending',
      // Independent of the DB save above — tracks whether this session has
      // also gone out to the separate, optional Prep-Center connection.
      // Starts 'pending' even when that connection isn't configured yet,
      // so it stays queued and goes out automatically the moment it is.
      prepSyncStatus: 'pending',
    };
    await docPut(document);
    setHistory((h) => [document, ...h]);
    setDocSeq((s) => ({ ...s, [direction]: s[direction] + 1 }));
    setConfirmedDoc(document);
    setPreviousScreen('confirm');
    setScreen('confirm');
    // Clear the working session now that it's captured in `document` and
    // saved — otherwise parcels.length > 0 keeps looking like an open
    // session forever, and the next tap on Inbound/Outbound "resumes" a
    // shipment that was actually already closed and signed.
    setParcels([]);
    setSignatureDataUrl(null);
    setSigInk(false);
    setCourierName('');
    setCourierCompany('');
    setPlate('');
    setShipment('');
    setDestination('');
    setSessionStartedAt(null);

    const pdfDataUrl = await renderPdfDataUrl(document);
    // Outbound only: the delivery notes that travel with the goods. Built here,
    // after the driver has signed, because the signature belongs on every one.
    const { ddts, excluded } = await buildDdtsForSession(document);
    // Carry the reason, not just the code. "The Prep-Center says this label does
    // not exist" and "we could not ask it" call for completely different actions
    // from the operator, and reporting the first when the second happened sends
    // them looking for a problem that is not theirs.
    const excludedDetail = excluded.map((p) => ({
      code: p.code,
      status: p.shipmentStatus === 'unknown' ? 'unknown' : 'unchecked',
      error: p.shipmentError || null,
    }));
    let updated = ddts.length || excluded.length
      ? { ...document, ddts, ddtExcluded: excluded.map((p) => p.code), excludedDetail }
      : document;
    const toastParts = [];
    // Always saved to our own database — this isn't optional, unlike the
    // Prep-Center push below.
    if (internalConfig) {
      const res = await api.pushSession(internalConfig, { ...updated, pdfDataUrl });
      const syncError = res.ok ? null : api.describeError(res);
      updated = { ...updated, syncStatus: res.ok ? 'ok' : 'failed', syncError };
      toastParts.push(res.ok ? `${doc} saved` : `${doc} failed to save — ${syncError}`);
      // The DDTs hang off the saved session, so they can only go after it.
      if (res.ok && ddts.length) {
        const ddtRes = await api.pushDdts(internalConfig, doc, ddts);
        updated = { ...updated, ddtSyncStatus: ddtRes.ok ? 'ok' : 'failed', ddtSyncError: ddtRes.ok ? null : ddtRes.error };
        toastParts.push(
          ddtRes.ok
            ? `${ddts.length} DDT${ddts.length > 1 ? 's' : ''} saved`
            : `DDT save failed — ${ddtRes.error}`,
        );
      } else if (ddts.length) {
        updated = { ...updated, ddtSyncStatus: 'pending', ddtSyncError: null };
      }
    }
    // Loudly, not silently: a box left off a delivery note is a box that
    // legally never left, and the operator is the only one who can still fix it
    // while the driver is at the bay.
    if (excluded.length) {
      toastParts.push(`${excluded.length} parcel${excluded.length > 1 ? 's' : ''} not on any DDT — no shipment found`);
    }
    // Separate, optional: also push to the Prep-Center connection from the
    // API screen, if one is configured and enabled. If it isn't, this
    // session just stays queued (`prepSyncStatus: 'pending'`) and goes out
    // automatically the next time that connection is reachable.
    if (apiConfig.baseUrl && apiConfig.autoPush) {
      const res = await api.pushSession(apiConfig, { ...updated, pdfDataUrl });
      const prepSyncError = res.ok ? null : api.describeError(res);
      updated = { ...updated, prepSyncStatus: res.ok ? 'ok' : 'failed', prepSyncError };
      toastParts.push(res.ok ? 'sent to Prep-Center' : `Prep-Center failed — ${prepSyncError}`);
    }
    await docPut(updated);
    setHistory((h) => h.map((d) => (d.doc === doc && d.country === document.country ? { ...d, ...updated } : d)));
    setConfirmedDoc((c) => (c && c.doc === doc && c.country === document.country ? { ...c, ...updated } : c));
    if (toastParts.length) showToast(toastParts.join(' · '));
  }, [direction, docSeq, carrier, courierCompany, shipment, destination, courierName, plate, shift, parcels, signatureDataUrl, internalConfig, apiConfig, showToast, renderPdfDataUrl, saveDriverProfile, buildDdtsForSession]);

  // The guarded entry point. Every caller uses this one, never `closeSession`.
  const finish = useCallback(async () => {
    if (!signReady) { showToast('Name and signature are required'); return; }
    // Checked and set in the same synchronous step, before the first `await`,
    // so there is no window for a second tap to slip through.
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    try {
      await closeSession();
    } finally {
      finishingRef.current = false;
      setFinishing(false);
    }
  }, [signReady, showToast, closeSession]);

  // Print or share one delivery note. The DDT travels with the goods, so the
  // driver needs it at the bay — it is no use only being in the database.
  const printDdt = useCallback(async (ddt) => {
    try {
      const mod = await import('../lib/pdfDoc');
      let dataUrl = ddt.pdfDataUrl;
      // A note this device issued can be rebuilt from its own data. One that
      // only exists as a database summary — a handover closed on another
      // phone — cannot, so the archived PDF is fetched instead. Reprinting
      // the stored file is also the more correct of the two: it is the sheet
      // the driver actually signed for, not a fresh rendering of it.
      if (!dataUrl && Array.isArray(ddt.parcels)) {
        const ddtMod = await import('../lib/ddtPdf');
        dataUrl = ddtMod.ddtDataUrl(ddt, orgSettings);
      }
      if (!dataUrl && internalConfig) {
        const res = await api.fetchArchivedPdf(internalConfig, ddt.number, 'ddt');
        if (res.ok) dataUrl = res.dataUrl;
        else throw new Error(res.error || 'not stored');
      }
      if (!dataUrl) throw new Error('no connection to fetch it from');
      await mod.exportPdfDataUrl(dataUrl, { doc: ddt.number });
    } catch (err) {
      showToast(`Could not open ${ddt.number} — ${String(err?.message || err)}`);
    }
  }, [orgSettings, showToast, internalConfig]);

  // ---- document export ----
  const printDocument = useCallback(async (document) => {
    try {
      const mod = await import('../lib/pdfDoc');
      // If Prep-Center already has this document, prefer its own archived
      // PDF (e.g. it may carry its own official numbering/stamps) over
      // regenerating one locally — falls back silently if that fails.
      if (apiConfig.baseUrl && document.prepSyncStatus === 'ok') {
        const archived = await api.fetchArchivedPdf(apiConfig, document.doc);
        if (archived.ok) {
          await mod.exportPdfDataUrl(archived.dataUrl, document);
          return;
        }
      }
      await mod.exportHandoverPdf(document, orgSettings);
    } catch (err) {
      showToast('Could not generate the PDF: ' + (err?.message || err));
    }
  }, [showToast, orgSettings, apiConfig]);
  const emailDocument = useCallback(async (document) => {
    showToast('Choose your mail app from the share sheet');
    await printDocument(document);
  }, [printDocument, showToast]);

  // ---- history ----
  const openSession = useCallback((doc) => { setSelectedDocNo(doc); setScreen('session'); }, []);
  const backToHistory = useCallback(() => { setSelectedDocNo(null); setScreen('history'); }, []);

  // ---- API tab ----
  const setApiBaseUrl = useCallback((v) => setApiConfig((c) => ({ ...c, baseUrl: v })), []);
  // Editing the key by hand always exits the "secured" (hidden-after-copy)
  // state — the operator typing/pasting a value already knows what it is.
  const setApiKey = useCallback((v) => setApiConfig((c) => ({ ...c, apiKey: v, keySecured: false })), []);
  const togglePush = useCallback(() => setApiConfig((c) => ({ ...c, autoPush: !c.autoPush })), []);
  const togglePull = useCallback(() => setApiConfig((c) => ({ ...c, autoPull: !c.autoPull })), []);
  const toggleShowKey = useCallback(() => setApiShowKey((v) => !v), []);
  // Generates a random, unique scanner API key on-device. The key itself
  // proves nothing to the backend by itself — it still has to be registered
  // there (per country/warehouse) before the server will accept it — this
  // just saves typing/inventing one by hand and reveals it so it can be
  // copied out and handed to whoever manages the WMS backend.
  const generateApiKey = useCallback(() => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    const key = `whs_${hex}`;
    setApiConfig((c) => ({ ...c, apiKey: key, keySecured: false }));
    setApiShowKey(true);
    showToast('New key generated — copy it now, then it will be hidden for security');
    return key;
  }, [showToast]);
  // One-time reveal: once the freshly generated (or currently shown) key
  // has been copied out, hide it and lock the Show/Hide toggle — a phone
  // left unlocked shouldn't let anyone re-reveal a secret that's already
  // been handed off. Editing the field or generating a new key unlocks it.
  const copyApiKey = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(apiConfig.apiKey);
      showToast('Copied — key is now hidden for security');
    } catch {
      showToast('Could not copy automatically — select and copy manually');
    }
    setApiShowKey(false);
    setApiConfig((c) => ({ ...c, keySecured: true }));
  }, [apiConfig.apiKey, showToast]);

  // `silent` is used for the automatic pull right after login — no need to
  // nag with "enable this first" on every login for installs that simply
  // don't use this feature; a manual tap on "Pull manifest now" still gets
  // the full explanation either way.
  const pullManifestNow = useCallback(async ({ silent = false } = {}) => {
    if (!apiConfig.autoPull || !apiConfig.baseUrl) {
      if (!silent) showToast('Enable "Receive expected manifest" first');
      return;
    }
    setPulling(true);
    const res = await api.pullManifest(apiConfig);
    setPulling(false);
    if (res.ok) {
      setManifest({ codes: res.codes, lastPulledAt: hhmm() });
      showToast(`${res.codes.length} tracking IDs received`);
    } else {
      showToast('Manifest pull failed: ' + res.error);
    }
  }, [apiConfig, showToast]);
  // Lets loginWithBadge (defined earlier in this file) trigger a pull
  // without a stale closure over apiConfig/showToast.
  const pullManifestNowRef = useRef(() => {});
  useEffect(() => { pullManifestNowRef.current = pullManifestNow; }, [pullManifestNow]);

  // Settings › Login history — pulled on demand (not auto-refreshed in the
  // background) since it's an audit view, not something the core scanning
  // flow depends on. Always our own database, never Prep-Center.
  const pullLoginEventsNow = useCallback(async () => {
    if (!internalConfig) return;
    setPullingLoginEvents(true);
    const res = await api.fetchLoginEvents(internalConfig);
    setPullingLoginEvents(false);
    if (res.ok) setLoginEvents(res.events);
    else showToast('Could not load login history: ' + res.error);
  }, [internalConfig, showToast]);

  // Pushes every not-yet-sent document (for the currently connected
  // country) to the Prep-Center connection — used both from `syncNow`
  // below and on its own, whenever there might newly be a working
  // connection to catch up on (right after the operator finishes typing
  // one into Settings, or the next time the app opens with one already
  // saved). A no-op whenever Prep-Center isn't configured/enabled, so it's
  // always safe to call speculatively. `silent` skips the toast for the
  // background trigger points, where popping one up would be unexpected.
  const syncPrepPending = useCallback(async ({ silent = false } = {}) => {
    if (!apiConfig.baseUrl || !apiConfig.autoPush) return { attempted: 0, ok: 0, fail: 0, lastError: null };
    const pending = history.filter((d) => d.prepSyncStatus !== 'ok' && d.country === shift?.country);
    let ok = 0, fail = 0, lastError = null;
    for (const d of pending) {
      const pdfDataUrl = await renderPdfDataUrl(d);
      const res = await api.pushSession(apiConfig, { ...d, pdfDataUrl });
      const prepSyncError = res.ok ? null : api.describeError(res);
      if (res.ok) ok++; else { fail++; lastError = prepSyncError; }
      await patchDocument(d.doc, d.country, { prepSyncStatus: res.ok ? 'ok' : 'failed', prepSyncError });
    }
    if (!silent) {
      showToast(
        !pending.length ? 'Prep-Center: up to date'
          : fail ? `Prep-Center: ${ok} sent, ${fail} failed — ${lastError}`
          : `Prep-Center: ${ok} sent`
      );
    }
    return { attempted: pending.length, ok, fail, lastError };
  }, [apiConfig, history, shift, showToast, renderPdfDataUrl, patchDocument]);
  const syncPrepPendingRef = useRef(() => {});
  useEffect(() => { syncPrepPendingRef.current = syncPrepPending; }, [syncPrepPending]);

  // Fires once the app has finished loading (cold start with a Prep-Center
  // connection already saved from before) and again on a genuine country
  // switch — deliberately NOT keyed on apiConfig.baseUrl/autoPush directly,
  // or this would re-fire on every keystroke while editing Settings. The
  // Settings screen instead calls syncPrepPending itself on blur, right
  // after the operator finishes typing a connection.
  useEffect(() => {
    if (!ready) return;
    syncPrepPendingRef.current({ silent: true });
  }, [ready, shift?.country]);

  const syncNow = useCallback(async () => {
    if (!internalConfig) { showToast('No connection for this country yet'); return; }
    setSyncing(true);
    // Only ever push documents that belong to the country currently
    // connected — `history` here is the raw, unfiltered state (this
    // function closes over it directly, not the country-filtered value
    // exposed to screens), so without this a stale unsynced document from
    // a country this device used earlier could get pushed into whichever
    // country is connected right now (the backend trusts the auth key for
    // schema routing, not the payload's own country field).
    const pending = history.filter((d) => d.syncStatus !== 'ok' && d.country === shift?.country);
    // A session can be saved while its delivery notes are not — the DDT push is
    // a second call, and the phone can lose the network between the two. These
    // are retried on their own, or the DDTs of an otherwise-synced session
    // would never be sent at all.
    const ddtPending = history.filter(
      (d) => d.country === shift?.country && d.syncStatus === 'ok' && d.ddtSyncStatus && d.ddtSyncStatus !== 'ok' && (d.ddts || []).length,
    );
    // Outbound sessions that produced no delivery notes at all because nothing
    // could be looked up at the time — scanned with no signal, typically. The
    // boxes are recorded and signed for; the documents are simply owed. Build
    // them now that there is a network, rather than leaving them owed forever.
    const ddtMissing = history.filter(
      (d) =>
        d.country === shift?.country &&
        d.direction === 'out' &&
        !(d.ddts || []).length &&
        (d.parcels || []).some((p) => p.shipmentStatus !== 'ok'),
    );
    let okCount = 0;
    let failCount = 0;
    let lastError = null;
    for (const d of pending) {
      const pdfDataUrl = await renderPdfDataUrl(d);
      const res = await api.pushSession(internalConfig, { ...d, pdfDataUrl });
      const syncError = res.ok ? null : api.describeError(res);
      if (res.ok) okCount++; else { failCount++; lastError = syncError; }
      const patch = { syncStatus: res.ok ? 'ok' : 'failed', syncError };
      if (res.ok && (d.ddts || []).length) {
        const ddtRes = await api.pushDdts(internalConfig, d.doc, d.ddts);
        patch.ddtSyncStatus = ddtRes.ok ? 'ok' : 'failed';
        patch.ddtSyncError = ddtRes.ok ? null : ddtRes.error;
      }
      await patchDocument(d.doc, d.country, patch);
    }
    let ddtOk = 0;
    let ddtFail = 0;
    let ddtBuilt = 0;
    for (const d of ddtMissing) {
      const { ddts, excluded } = await buildDdtsForSession(d);
      if (!ddts.length) continue;   // still nothing to place — try again next time
      ddtBuilt += ddts.length;
      // Keep the built notes before pushing. They carry reserved numbers from
      // the DDT series, so a failed push must not cause them to be built a
      // second time — that would burn numbers and leave gaps in a legal series.
      await patchDocument(d.doc, d.country, { ddts, ddtExcluded: excluded.map((p) => p.code) });
      const ddtRes = await api.pushDdts(internalConfig, d.doc, ddts);
      if (ddtRes.ok) ddtOk++; else ddtFail++;
      await patchDocument(d.doc, d.country, {
        ddtSyncStatus: ddtRes.ok ? 'ok' : 'failed',
        ddtSyncError: ddtRes.ok ? null : ddtRes.error,
      });
    }
    for (const d of ddtPending) {
      const ddtRes = await api.pushDdts(internalConfig, d.doc, d.ddts);
      if (ddtRes.ok) ddtOk++; else ddtFail++;
      await patchDocument(d.doc, d.country, {
        ddtSyncStatus: ddtRes.ok ? 'ok' : 'failed',
        ddtSyncError: ddtRes.ok ? null : ddtRes.error,
      });
    }
    // Same pass, second destination — reported together so "Sync now"
    // reads as one action even though it talks to two systems.
    const prepResult = await syncPrepPending({ silent: true });
    setSyncing(false);
    const parts = [
      !pending.length ? 'DB: nothing pending' : failCount ? `DB: ${okCount} sent, ${failCount} failed — ${lastError}` : `DB: ${okCount} sent`,
    ];
    if (ddtOk || ddtFail) {
      const built = ddtBuilt ? ` (${ddtBuilt} newly issued)` : '';
      parts.push(ddtFail ? `DDT: ${ddtOk} sent, ${ddtFail} failed${built}` : `DDT: ${ddtOk} sent${built}`);
    }
    if (apiConfig.baseUrl) {
      parts.push(
        !prepResult.attempted ? 'Prep-Center: up to date'
          : prepResult.fail ? `Prep-Center: ${prepResult.ok} sent, ${prepResult.fail} failed — ${prepResult.lastError}`
          : `Prep-Center: ${prepResult.ok} sent`
      );
    }
    showToast(parts.join(' · '));
  }, [internalConfig, apiConfig.baseUrl, history, shift, showToast, renderPdfDataUrl, syncPrepPending, buildDdtsForSession, patchDocument]);

  const retrySync = useCallback(async (doc) => {
    const d = history.find((x) => x.doc === doc && x.country === shift?.country);
    if (!d) return;
    const pdfDataUrl = await renderPdfDataUrl(d);
    let current = d;
    const parts = [];
    if (internalConfig && d.syncStatus !== 'ok') {
      const res = await api.pushSession(internalConfig, { ...current, pdfDataUrl });
      const syncError = res.ok ? null : api.describeError(res);
      current = await patchDocument(doc, d.country, { syncStatus: res.ok ? 'ok' : 'failed', syncError });
      parts.push(res.ok ? 'DB sent' : `DB failed — ${syncError}`);
    }
    // Retrying one row has to cover its delivery notes too, or a session whose
    // DDT push was the part that failed would report "sent" and still owe them.
    if (internalConfig && current.syncStatus === 'ok' && (current.ddts || []).length && current.ddtSyncStatus !== 'ok') {
      const res = await api.pushDdts(internalConfig, doc, current.ddts);
      current = await patchDocument(doc, d.country, {
        ddtSyncStatus: res.ok ? 'ok' : 'failed',
        ddtSyncError: res.ok ? null : res.error,
      });
      parts.push(res.ok ? `${current.ddts.length} DDT sent` : `DDT failed — ${res.error}`);
    }
    if (apiConfig.baseUrl && apiConfig.autoPush && d.prepSyncStatus !== 'ok') {
      const res = await api.pushSession(apiConfig, { ...current, pdfDataUrl });
      const prepSyncError = res.ok ? null : api.describeError(res);
      current = await patchDocument(doc, d.country, { prepSyncStatus: res.ok ? 'ok' : 'failed', prepSyncError });
      parts.push(res.ok ? 'Prep-Center sent' : `Prep-Center failed — ${prepSyncError}`);
    }
    showToast(parts.length ? `${doc}: ${parts.join(' · ')}` : `${doc} already up to date`);
  }, [internalConfig, apiConfig, history, shift, showToast, renderPdfDataUrl, patchDocument]);

  // Every screen reads `history`/`driverProfiles` through this context —
  // filtering once, here, means each country only ever sees its own data
  // (documents, sync queue, driver picker) on a device that gets reused
  // across countries over time, with zero changes needed in the screens
  // themselves. The raw, unfiltered state stays available to the functions
  // above (`syncNow`, `retrySync`, the init-load effect, etc.) that
  // legitimately need to see or migrate every country's data on this
  // device, not just the currently active one.
  const visibleHistory = useMemo(() => history.filter((d) => d.country === shift?.country), [history, shift]);
  const visibleDriverProfiles = useMemo(() => driverProfiles.filter((p) => p.country === shift?.country), [driverProfiles, shift]);
  // Always merges in the built-in static list (lib/carriers.js) underneath
  // whatever's been synced/added locally for this country — a fresh
  // install, or the moment before pullCarriersNow's response lands, still
  // shows the full default roster instead of an empty/partial list, and a
  // newly-added custom carrier doesn't make the built-in ones disappear
  // (an earlier version of this fell back to the static list ONLY when the
  // synced list was completely empty, which broke the instant a single
  // custom carrier was added — the static defaults vanished entirely).
  const visibleCarriers = useMemo(() => {
    const byName = new Map(carriersForCountry(shift?.country).map((name) => [name.toLowerCase(), { name, pattern: null }]));
    for (const c of carriers) {
      if (c.country === shift?.country) byName.set(c.name.toLowerCase(), c);
    }
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [carriers, shift]);

  const value = useMemo(() => ({
    ready, now,
    shift, loginWithBadge, endShift, updateOperatorName,
    screen, setScreen, canGoBack, goBack, goHome, goToHistoryTab, goToDocsTab, goToApiTab, goToSettings,
    direction, carrier, setCarrier, courierCompany, setCourierCompany, shipment, setShipment,
    destination, setDestination,
    parcels, sessionStartedAt, startSession, toScan, docSeq,
    submitScan, accept, dupCode, dupTime, closeDup, dupAddBox,
    boxPlus, boxMinus, removeLast, removeParcel, flash,
    damageSheet, openDamage, closeDamage, toggleDamageType, setDamageNote, setDamagePhoto, saveDamage, damageTypes: DAMAGE_TYPES,
    noCodeSheet, openNoCodeSheet, closeNoCodeSheet, setNoCodeNote, setNoCodePhoto, saveNoCode, rejectedScan,
    courierName, setCourierName, plate, setPlate,
    signatureDataUrl, setSignatureDataUrl, sigInk, setSigInk, clearSignature, signReady, toSign, finish, finishing,
    confirmedDoc, printDocument, printDdt, emailDocument,
    history: visibleHistory, historyQuery, setHistoryQuery, historyFilter, setHistoryFilter, selectedDocNo, openSession, backToHistory,
    apiConfig, apiShowKey, setApiBaseUrl, setApiKey, generateApiKey, copyApiKey, togglePush, togglePull, toggleShowKey,
    manifest, pulling, pullManifestNow, syncing, syncNow, retrySync, syncPrepPending,
    orgSettings, updateOrgSettings,
    driverProfiles: visibleDriverProfiles, applyDriverProfile,
    carriers: visibleCarriers, saveCarrier,
    viewingPhoto, openPhoto, closePhoto,
    loginEvents, pullingLoginEvents, pullLoginEventsNow,
    updateInfo, updateDismissed, checkUpdateNow, dismissUpdate, downloadUpdate,
    toast, showToast,
    inputRef,
  }), [
    ready, now, shift, loginWithBadge, endShift, updateOperatorName, screen, canGoBack, goBack, goHome, goToHistoryTab, goToDocsTab, goToApiTab, goToSettings,
    direction, carrier, courierCompany, shipment, parcels, sessionStartedAt, startSession, toScan, docSeq,
    submitScan, accept, dupCode, dupTime, closeDup, dupAddBox, boxPlus, boxMinus, removeLast, removeParcel, flash,
    damageSheet, openDamage, closeDamage, toggleDamageType, setDamageNote, setDamagePhoto, saveDamage,
    noCodeSheet, openNoCodeSheet, closeNoCodeSheet, setNoCodeNote, setNoCodePhoto, saveNoCode, rejectedScan,
    courierName, plate, signatureDataUrl, sigInk, clearSignature, signReady, toSign, finish, finishing,
    confirmedDoc, printDocument, printDdt, emailDocument, visibleHistory, historyQuery, historyFilter, selectedDocNo, openSession, backToHistory,
    apiConfig, apiShowKey, setApiBaseUrl, setApiKey, generateApiKey, copyApiKey, togglePush, togglePull, toggleShowKey,
    manifest, pulling, pullManifestNow, syncing, syncNow, retrySync, syncPrepPending,
    orgSettings, updateOrgSettings, visibleDriverProfiles, applyDriverProfile, visibleCarriers, saveCarrier, viewingPhoto, openPhoto, closePhoto,
    loginEvents, pullingLoginEvents, pullLoginEventsNow,
    updateInfo, updateDismissed, checkUpdateNow, dismissUpdate, downloadUpdate, toast, showToast,
  ]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
