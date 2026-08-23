import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { docsGetAll, docPut, docsClearAll, kvGet, kvSet } from '../lib/db';
import { DEFAULT_BADGE_NAMES, DEFAULT_ORG_SETTINGS } from '../lib/seed';
import { DAMAGE_TYPES } from '../lib/carriers';
import { hhmm, stamp, docNumber } from '../lib/format';
import { feedback } from '../lib/audio';
import * as api from '../lib/api';
import { checkForUpdate, openDownload } from '../lib/updateCheck';

const AppCtx = createContext(null);

const INITIAL_API_CONFIG = { baseUrl: '', apiKey: '', autoPush: false, autoPull: false };

export function AppProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [shift, setShift] = useState(null);
  const [screen, setScreen] = useState('login');
  const [previousScreen, setPreviousScreen] = useState('home');

  const [direction, setDirection] = useState('in');
  const [carrier, setCarrier] = useState('DHL');
  const [courierCompany, setCourierCompany] = useState('');
  const [shipment, setShipment] = useState('');
  const [parcels, setParcels] = useState([]);
  const [sessionStartedAt, setSessionStartedAt] = useState(null);

  const [courierName, setCourierName] = useState('');
  const [plate, setPlate] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState(null);
  const [sigInk, setSigInk] = useState(false);

  const [dupCode, setDupCode] = useState(null);
  const [dupTime, setDupTime] = useState(null);
  const [flash, setFlash] = useState(null); // 'ok' | 'bad' | null

  const [damageSheet, setDamageSheet] = useState({ open: false, picks: [], note: '', photoDataUrl: null });

  const [toast, setToastState] = useState(null);
  const toastTimer = useRef(null);

  const [confirmedDoc, setConfirmedDoc] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyFilter, setHistoryFilter] = useState('all');
  const [selectedDocNo, setSelectedDocNo] = useState(null);

  const [apiConfig, setApiConfig] = useState(INITIAL_API_CONFIG);
  const [apiShowKey, setApiShowKey] = useState(false);
  const [manifest, setManifest] = useState({ codes: [], lastPulledAt: null });
  const [pulling, setPulling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [docSeq, setDocSeq] = useState({ in: 1, out: 1 });
  const [orgSettings, setOrgSettings] = useState(DEFAULT_ORG_SETTINGS);
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
      const [savedShift, savedApi, savedManifest, savedSeq, savedOrg, docs, docSeqReset, historyWiped] = await Promise.all([
        kvGet('shift', null),
        kvGet('apiConfig', INITIAL_API_CONFIG),
        kvGet('manifest', { codes: [], lastPulledAt: null }),
        kvGet('docSeq', { in: 1, out: 1 }),
        kvGet('orgSettings', DEFAULT_ORG_SETTINGS),
        docsGetAll(),
        kvGet('docSeqResetV2', false),
        kvGet('historyWipeV1', false),
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
      setApiConfig(savedApi);
      setManifest(manifestState);
      setDocSeq(seqToUse);
      setOrgSettings({ ...DEFAULT_ORG_SETTINGS, ...savedOrg });
      if (savedShift) {
        setShift(savedShift);
        setScreen('home');
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => { if (ready) kvSet('apiConfig', apiConfig); }, [ready, apiConfig]);
  useEffect(() => { if (ready) kvSet('manifest', manifest); }, [ready, manifest]);
  useEffect(() => { if (ready) kvSet('docSeq', docSeq); }, [ready, docSeq]);
  useEffect(() => { if (ready && shift) kvSet('shift', shift); }, [ready, shift]);
  useEffect(() => { if (ready) kvSet('orgSettings', orgSettings); }, [ready, orgSettings]);

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
  const loginWithBadge = useCallback((badgeId, operatorName) => {
    const s = { badgeId: badgeId || 'BADGE-0000', operatorName: operatorName || 'Operator', startedAt: Date.now() };
    setShift(s);
    setScreen('home');
  }, []);
  const endShift = useCallback(() => {
    setShift(null);
    kvSet('shift', null);
    setScreen('login');
  }, []);
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
    setConfirmedDoc(null);
    setSignatureDataUrl(null);
    setSigInk(false);
    setAgreed(false);
    setCourierName('');
    setPlate('');
    setShipment('');
    setSessionStartedAt(Date.now());
    setScreen('setup');
  }, [parcels.length, screen, direction, showToast]);
  const toScan = useCallback(() => { setSessionStartedAt(Date.now()); setScreen('scan'); }, []);

  // ---- scanning ----
  const accept = useCallback((code) => {
    const expected = apiConfig.autoPull && manifest.codes.length ? manifest.codes.includes(code) : null;
    feedback(false);
    setParcels((p) => p.concat([{ code, carrier, boxes: 1, time: hhmm(), damage: null, photo: null, expected }]));
    setFlash('ok');
    setTimeout(() => setFlash((f) => (f === 'ok' ? null : f)), 700);
  }, [apiConfig.autoPull, manifest.codes, carrier]);

  const submitScan = useCallback((raw) => {
    const code = String(raw || '').trim().toUpperCase();
    if (!code) return;
    const dup = parcels.find((p) => p.code === code);
    if (dup) {
      feedback(true);
      setDupCode(code);
      setDupTime(dup.time);
      setFlash('bad');
      return;
    }
    accept(code);
  }, [parcels, accept]);

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

    if (apiConfig.autoPush && trackingCode) {
      api.pushDamage(apiConfig, trackingCode, {
        tracking: trackingCode,
        type: label,
        photo: damageSheet.photoDataUrl,
        recorded_at: new Date().toISOString(),
      }).then((res) => {
        if (!res.ok) showToast(`Damage push to ERP failed for ${trackingCode} — will still go out with the session`);
      });
    }
  }, [damageSheet, docSeq, direction, parcels, apiConfig, showToast]);

  // ---- signature ----
  const toSign = useCallback(() => {
    if (!parcels.length) { showToast('Nothing scanned yet'); return; }
    setScreen('sign');
  }, [parcels.length, showToast]);
  const clearSignature = useCallback(() => { setSignatureDataUrl(null); setSigInk(false); }, []);
  const toggleAgree = useCallback(() => setAgreed((a) => !a), []);

  const signReady = courierName.trim().length > 1 && sigInk && agreed;

  const finish = useCallback(async () => {
    if (!signReady) { showToast('Name, signature and confirmation are required'); return; }
    const now2 = new Date();
    const doc = docNumber(direction, docSeq[direction]);
    const document = {
      doc,
      direction,
      carrier,
      courierCompany,
      shipment,
      driverName: courierName,
      plate,
      operator: `${shift?.operatorName || 'Operator'} · ${shift?.badgeId || ''}`,
      operatorBadge: shift?.badgeId || '',
      parcels,
      signatureDataUrl,
      date: stamp(now2),
      docTime: stamp(now2),
      closedAtIso: now2.toISOString(),
      syncStatus: apiConfig.autoPush ? 'pending' : 'pending',
    };
    await docPut(document);
    setHistory((h) => [document, ...h]);
    setDocSeq((s) => ({ ...s, [direction]: s[direction] + 1 }));
    setConfirmedDoc(document);
    setPreviousScreen('confirm');
    setScreen('confirm');

    if (apiConfig.autoPush) {
      const res = await api.pushSession(apiConfig, document);
      const syncError = res.ok ? null : api.describeError(res);
      const updated = { ...document, syncStatus: res.ok ? 'ok' : 'failed', syncError };
      await docPut(updated);
      setHistory((h) => h.map((d) => (d.doc === doc ? updated : d)));
      setConfirmedDoc((c) => (c && c.doc === doc ? updated : c));
      showToast(res.ok ? `${doc} sent to the ERP` : `${doc} failed to send — ${syncError}`);
    }
  }, [signReady, direction, docSeq, carrier, courierCompany, shipment, courierName, plate, shift, parcels, signatureDataUrl, apiConfig, showToast]);

  // ---- document export ----
  const printDocument = useCallback(async (document) => {
    try {
      const mod = await import('../lib/pdfDoc');
      // If the ERP already has this document, prefer its own archived PDF
      // (e.g. it may carry the ERP's official numbering/stamps) over
      // regenerating one locally — falls back silently if that fails.
      if (apiConfig.baseUrl && document.syncStatus === 'ok') {
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
  const setApiKey = useCallback((v) => setApiConfig((c) => ({ ...c, apiKey: v })), []);
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
    setApiConfig((c) => ({ ...c, apiKey: key }));
    setApiShowKey(true);
    showToast('New key generated — register it with the WMS backend, then save');
    return key;
  }, [showToast]);

  const pullManifestNow = useCallback(async () => {
    if (!apiConfig.autoPull) { showToast('Enable "Receive expected manifest" first'); return; }
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

  const syncNow = useCallback(async () => {
    if (!apiConfig.autoPush) { showToast('Enable "Send sessions automatically" first'); return; }
    setSyncing(true);
    const pending = history.filter((d) => d.syncStatus !== 'ok');
    let okCount = 0;
    let failCount = 0;
    let lastError = null;
    for (const d of pending) {
      const res = await api.pushSession(apiConfig, d);
      const syncError = res.ok ? null : api.describeError(res);
      if (res.ok) okCount++; else { failCount++; lastError = syncError; }
      const updated = { ...d, syncStatus: res.ok ? 'ok' : 'failed', syncError };
      await docPut(updated);
      setHistory((h) => h.map((x) => (x.doc === d.doc ? updated : x)));
    }
    setSyncing(false);
    showToast(
      !pending.length ? 'Nothing pending'
        : failCount ? `${okCount} sent · ${failCount} failed — ${lastError}`
        : `${okCount} sent`
    );
  }, [apiConfig, history, showToast]);

  const retrySync = useCallback(async (doc) => {
    const d = history.find((x) => x.doc === doc);
    if (!d) return;
    const res = await api.pushSession(apiConfig, d);
    const syncError = res.ok ? null : api.describeError(res);
    const updated = { ...d, syncStatus: res.ok ? 'ok' : 'failed', syncError };
    await docPut(updated);
    setHistory((h) => h.map((x) => (x.doc === doc ? updated : x)));
    showToast(res.ok ? `${doc} sent` : `${doc} failed — ${syncError}`);
  }, [apiConfig, history, showToast]);

  const value = useMemo(() => ({
    ready, now,
    shift, loginWithBadge, endShift, updateOperatorName,
    screen, setScreen, canGoBack, goBack, goHome, goToHistoryTab, goToDocsTab, goToApiTab, goToSettings,
    direction, carrier, setCarrier, courierCompany, setCourierCompany, shipment, setShipment,
    parcels, sessionStartedAt, startSession, toScan, docSeq,
    submitScan, accept, dupCode, dupTime, closeDup, dupAddBox,
    boxPlus, boxMinus, removeLast, flash,
    damageSheet, openDamage, closeDamage, toggleDamageType, setDamageNote, setDamagePhoto, saveDamage, damageTypes: DAMAGE_TYPES,
    courierName, setCourierName, plate, setPlate, agreed, toggleAgree,
    signatureDataUrl, setSignatureDataUrl, sigInk, setSigInk, clearSignature, signReady, toSign, finish,
    confirmedDoc, printDocument, emailDocument,
    history, historyQuery, setHistoryQuery, historyFilter, setHistoryFilter, selectedDocNo, openSession, backToHistory,
    apiConfig, apiShowKey, setApiBaseUrl, setApiKey, generateApiKey, togglePush, togglePull, toggleShowKey,
    manifest, pulling, pullManifestNow, syncing, syncNow, retrySync,
    orgSettings, updateOrgSettings,
    viewingPhoto, openPhoto, closePhoto,
    updateInfo, updateDismissed, checkUpdateNow, dismissUpdate, downloadUpdate,
    toast, showToast,
    inputRef,
  }), [
    ready, now, shift, loginWithBadge, endShift, updateOperatorName, screen, canGoBack, goBack, goHome, goToHistoryTab, goToDocsTab, goToApiTab, goToSettings,
    direction, carrier, courierCompany, shipment, parcels, sessionStartedAt, startSession, toScan, docSeq,
    submitScan, accept, dupCode, dupTime, closeDup, dupAddBox, boxPlus, boxMinus, removeLast, flash,
    damageSheet, openDamage, closeDamage, toggleDamageType, setDamageNote, setDamagePhoto, saveDamage,
    courierName, plate, agreed, toggleAgree, signatureDataUrl, sigInk, clearSignature, signReady, toSign, finish,
    confirmedDoc, printDocument, emailDocument, history, historyQuery, historyFilter, selectedDocNo, openSession, backToHistory,
    apiConfig, apiShowKey, setApiBaseUrl, setApiKey, generateApiKey, togglePush, togglePull, toggleShowKey,
    manifest, pulling, pullManifestNow, syncing, syncNow, retrySync,
    orgSettings, updateOrgSettings, viewingPhoto, openPhoto, closePhoto,
    updateInfo, updateDismissed, checkUpdateNow, dismissUpdate, downloadUpdate, toast, showToast,
  ]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
