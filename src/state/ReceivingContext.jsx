import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppContext';
import * as rx from '../lib/prepReceiving';
import { readReceivedUnits, setReceivedUnits, findShelf, loadClientDefaultShelf, postReceptionNote } from '../lib/prepReceivingSave';
import { kvGet, kvSet } from '../lib/db';

// Receiving ("Recepție marfă") state, kept apart from AppContext, which already
// carries the courier handover flow. Reads and writes go to the Prep-Center
// with the operator's own session (lib/prepReceiving.js, lib/prepReceivingSave.js).
//
// Received units go through a queue, one entry per product line, so scanning
// never waits for the network and survives a dropped connection or a restart:
//   pendingDelta    units scanned / undone, not yet sent
//   pendingSet      an absolute count typed in by hand, not yet sent
//   inflightTarget  the absolute count being written right now
// A scan is a delta on top of whatever the Prep-Center has when it is sent
// (so two operators on one line add up); the moment it is sent it becomes an
// absolute target, stored before the write starts, so a retry after a lost
// answer writes the same number again instead of adding the units twice.
//
// Entries are per line *and shelf* (key "lineId@shelfId", or "@default" for
// the client's default shelf): units scanned with shelf A active go to A even
// if the operator has moved on to shelf B before they are sent.

const DEFAULT_SHELF = 'default';
const entryKey = (lineId, shelf) => `${lineId}@${shelf?.id || DEFAULT_SHELF}`;
const byCreation = (a, b) => (a.createdAt ?? a.updatedAt) - (b.createdAt ?? b.updatedAt);
const STATUS_RANK = { error: 4, waiting: 3, sending: 2, pending: 1 };

const RecvCtx = createContext(null);

// What the operator is told when a Prep-Center call fails.
export function recvErrorText(reason) {
  if (reason === 'offline') return "Can't reach the Prep-Center — check the connection.";
  if (reason === 'expired') return 'Your Prep-Center session has ended. End the shift and scan your badge to sign in again.';
  if (reason === 'notSignedIn') return 'Receiving needs a Prep-Center sign-in. End the shift and scan your badge.';
  if (reason === 'notFound') return 'This reception no longer exists on the Prep-Center.';
  if (reason === 'removalOrder') return 'Amazon removal orders are received on the Prep-Center website.';
  if (reason === 'cancelled') return 'This reception was cancelled.';
  return 'The Prep-Center returned an error. Try again.';
}

export function ReceivingProvider({ children }) {
  const { shift, withPrep, setScreen } = useApp();
  const country = shift?.country;

  const [open, setOpen] = useState({ rows: [], loading: false, error: null, loadedAt: null });
  // Last tracking lookup / free search: { kind: 'tracking' | 'search', query, rows, exact, error }
  const [lookup, setLookup] = useState(null);
  const [looking, setLooking] = useState(false);
  const [current, setCurrent] = useState({ id: null, reception: null, loading: false, error: null });
  const currentIdRef = useRef(null);
  const shiftRef = useRef(shift);
  useEffect(() => { shiftRef.current = shift; }, [shift]);

  // ---- received-units queue ----
  const [queue, setQueue] = useState({});
  const queueRef = useRef({});
  // Outcome of the last save per line: { placedOn, placementError, belowAssigned }
  const [results, setResults] = useState({});
  const undoStackRef = useRef([]);
  const [undoTop, setUndoTop] = useState(null);

  const commitQueue = useCallback((next) => {
    queueRef.current = next;
    setQueue(next);
    kvSet('recvQueue', next);
  }, []);
  const updateEntry = useCallback((key, fn) => {
    const nextEntry = fn(queueRef.current[key] || null);
    const next = { ...queueRef.current };
    if (nextEntry) next[key] = { ...nextEntry, updatedAt: Date.now() };
    else delete next[key];
    commitQueue(next);
  }, [commitQueue]);

  // ---- shelf ----
  // The shelf the operator scanned last for this reception: new units go
  // there. null = the client's default shelf (as the website does), shown as
  // `defaultShelf` ({ loading, shelf }).
  const [activeShelf, setActiveShelfState] = useState(null);
  const activeShelfRef = useRef(null);
  const setActiveShelf = useCallback((shelf) => {
    activeShelfRef.current = shelf;
    setActiveShelfState(shelf);
  }, []);
  const [defaultShelf, setDefaultShelf] = useState({ loading: false, shelf: null });

  // The line's count as the Prep-Center has it, once a save comes back.
  const applyServerReceived = useCallback((lineId, received) => {
    setCurrent((c) => {
      if (!c.reception) return c;
      if (!c.reception.lines.some((l) => l.id === lineId)) return c;
      const lines = c.reception.lines.map((l) => (l.id === lineId ? { ...l, received } : l));
      return { ...c, reception: { ...c.reception, lines, status: rx.computeStatus(c.reception.storedStatus, lines) } };
    });
  }, []);

  const refreshOpen = useCallback(async () => {
    if (!country) return;
    setOpen((o) => ({ ...o, loading: true, error: null }));
    const res = await withPrep((t) => rx.listOpenReceptions(t, country));
    setOpen((o) => (res.ok
      ? { rows: res.rows, loading: false, error: null, loadedAt: Date.now() }
      : { ...o, loading: false, error: res.reason }));
  }, [country, withPrep]);

  const openReception = useCallback(async (id) => {
    // A different reception starts a fresh undo history and shelf choice: a
    // shelf is checked against the reception's client.
    if (currentIdRef.current !== id) {
      undoStackRef.current = [];
      setUndoTop(null);
      setActiveShelf(null);
      setDefaultShelf({ loading: true, shelf: null });
    }
    currentIdRef.current = id;
    setCurrent((c) => ({ id, reception: c.id === id ? c.reception : null, loading: true, error: null }));
    setScreen('recvOrder');
    const res = await withPrep((t) => rx.loadReception(t, id));
    if (currentIdRef.current !== id) return; // the operator moved on meanwhile
    setCurrent((c) => (res.ok
      ? { id, reception: res.reception, loading: false, error: null }
      : { ...c, loading: false, error: res.reason }));
    if (res.ok) {
      const r = res.reception;
      const def = await withPrep((t) => loadClientDefaultShelf(t, r.clientId, r.warehouseCountry || shiftRef.current?.country));
      if (currentIdRef.current === id) setDefaultShelf({ loading: false, shelf: def.ok ? def.shelf : null });
    }
  }, [withPrep, setScreen, setActiveShelf]);

  /** A scanned or typed shelf code → the active shelf, if this client may use it. */
  const setShelfByCode = useCallback(async (code) => {
    const r = current.reception;
    if (!r) return { ok: false, reason: 'notFound' };
    const res = await withPrep((t) => findShelf(t, { code, country: r.warehouseCountry || country, clientId: r.clientId }));
    if (res.ok && currentIdRef.current === r.id) setActiveShelf(res.shelf);
    return res;
  }, [current.reception, withPrep, country, setActiveShelf]);
  const clearShelf = useCallback(() => setActiveShelf(null), [setActiveShelf]);

  const reloadCurrent = useCallback(() => {
    if (currentIdRef.current) openReception(currentIdRef.current);
  }, [openReception]);

  // A scanned parcel: exactly one reception opens it straight away; several
  // are listed to choose from; none is reported.
  const lookupTracking = useCallback(async (code) => {
    if (!country) return;
    const query = rx.normalizeTracking(code);
    setLooking(true);
    const res = await withPrep((t) => rx.findByTracking(t, country, query));
    setLooking(false);
    if (!res.ok) {
      setLookup({ kind: 'tracking', query, rows: [], exact: true, error: res.reason });
      return;
    }
    setLookup({ kind: 'tracking', query, rows: res.rows, exact: res.exact, error: null });
    if (res.exact && res.rows.length === 1) openReception(res.rows[0].id);
  }, [country, withPrep, openReception]);

  const searchReceptions = useCallback(async (text) => {
    const query = String(text || '').trim();
    if (!country || !query) return;
    setLooking(true);
    const res = await withPrep((t) => rx.searchAllReceptions(t, country, query));
    setLooking(false);
    setLookup({ kind: 'search', query, rows: res.ok ? res.rows : [], exact: true, error: res.ok ? null : res.reason });
  }, [country, withPrep]);

  const clearLookup = useCallback(() => setLookup(null), []);

  // From a confirmed courier handover: the receptions its parcels belong to.
  // One reception opens directly; several are listed; parcels with no
  // reception are named so the office can chase them.
  const lookupHandover = useCallback(async (codes, label) => {
    if (!country) return;
    setScreen('recvStart');
    setLooking(true);
    setLookup({ kind: 'handover', query: label, rows: [], unmatched: [], exact: true, error: null, loading: true });
    const res = await withPrep((t) => rx.findByTrackings(t, country, codes));
    setLooking(false);
    if (!res.ok) {
      setLookup({ kind: 'handover', query: label, rows: [], unmatched: [], exact: true, error: res.reason });
      return;
    }
    setLookup({ kind: 'handover', query: label, rows: res.rows, unmatched: res.unmatched, exact: true, error: null });
    if (res.rows.length === 1) openReception(res.rows[0].id);
  }, [country, withPrep, setScreen, openReception]);

  /** A message on the open reception's thread (the client sees it), then reload. */
  const sendNote = useCallback(async (body) => {
    const id = currentIdRef.current;
    if (!id || !String(body || '').trim()) return { ok: false, reason: 'empty' };
    const res = await withPrep((t) => postReceptionNote(t, id, body));
    if (res.ok) {
      const again = await withPrep((t) => rx.loadReception(t, id));
      if (again.ok && currentIdRef.current === id) setCurrent((c) => ({ ...c, reception: again.reception }));
    }
    return res;
  }, [withPrep]);

  // One line at a time, in the order they were touched. Only the operator who
  // scanned them sends them: the write is recorded as theirs.
  const drainingRef = useRef(false);
  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    const touchedShipments = new Set();
    try {
      for (;;) {
        const actorId = shiftRef.current?.prep?.userId;
        const shiftCountry = shiftRef.current?.country;
        if (!actorId) break;
        const entry = Object.values(queueRef.current)
          .filter((e) => e.actorId === actorId && e.status === 'pending')
          .sort(byCreation)[0];
        if (!entry) break;
        const { key, lineId, shipmentId, shelf } = entry;

        let target = entry.inflightTarget;
        if (target == null) {
          if (entry.pendingSet != null) {
            target = entry.pendingSet + entry.pendingDelta;
          } else {
            const r = await withPrep((t) => readReceivedUnits(t, lineId));
            if (!r.ok) {
              const soft = ['offline', 'expired', 'unauthorized', 'notSignedIn'].includes(r.reason);
              updateEntry(key, (e) => e && { ...e, status: soft ? 'waiting' : 'error', error: r.reason, message: r.message || null });
              continue;
            }
            target = r.received + entry.pendingDelta;
          }
          target = Math.max(0, target);
          const fixed = target;
          updateEntry(key, (e) => e && { ...e, inflightTarget: fixed, pendingSet: null, pendingDelta: 0, status: 'sending', error: null });
        } else {
          updateEntry(key, (e) => e && { ...e, status: 'sending', error: null });
        }

        const res = await withPrep((t) => setReceivedUnits(t, { shipmentId, itemId: lineId, target, actorId, country: shiftCountry, shelf: shelf || null }));
        touchedShipments.add(shipmentId);
        if (res.ok) {
          applyServerReceived(lineId, res.received);
          if (!res.unchanged) setResults((m) => ({ ...m, [lineId]: { placedOn: res.placedOn || null, placementError: res.placementError || null } }));
          updateEntry(key, (e) => {
            if (!e) return null;
            const rest = { ...e, inflightTarget: null, status: 'pending', error: null, message: null };
            return rest.pendingDelta === 0 && rest.pendingSet == null ? null : rest;
          });
        } else if (['offline', 'expired', 'unauthorized', 'notSignedIn'].includes(res.reason)) {
          updateEntry(key, (e) => e && { ...e, status: 'waiting', error: res.reason });
        } else if (res.reason === 'belowAssigned') {
          // Nothing was written. Show the Prep-Center's count and why.
          if (res.received != null) applyServerReceived(lineId, res.received);
          setResults((m) => ({ ...m, [lineId]: { belowAssigned: res.assigned } }));
          updateEntry(key, (e) => {
            if (!e) return null;
            const rest = { ...e, inflightTarget: null, status: 'pending', error: null };
            return rest.pendingDelta === 0 && rest.pendingSet == null ? null : rest;
          });
        } else {
          updateEntry(key, (e) => e && { ...e, status: 'error', error: res.reason, message: res.message || null });
        }
      }
    } finally {
      drainingRef.current = false;
    }
    // Pick up what the Prep-Center derived (status, stock links) once the
    // open reception's lines are all sent.
    const openId = currentIdRef.current;
    if (openId && touchedShipments.has(openId) && !Object.values(queueRef.current).some((e) => e.shipmentId === openId)) {
      const res = await withPrep((t) => rx.loadReception(t, openId));
      if (res.ok && currentIdRef.current === openId) setCurrent((c) => ({ ...c, reception: res.reception }));
    }
  }, [withPrep, updateEntry, applyServerReceived]);

  // Saved queue from before a restart; retry what waited for a connection.
  useEffect(() => {
    let alive = true;
    kvGet('recvQueue', {}).then((saved) => {
      if (!alive || !saved || typeof saved !== 'object') return;
      // Anything caught mid-send is resent with its stored target.
      // Entries saved before shelves existed were keyed by line alone.
      const restored = Object.fromEntries(Object.values(saved).filter((e) => e?.lineId).map((e) => {
        const key = e.key || entryKey(e.lineId, e.shelf);
        return [key, { ...e, key, createdAt: e.createdAt ?? e.updatedAt ?? Date.now(), status: e.status === 'error' ? 'error' : 'pending' }];
      }));
      queueRef.current = { ...restored, ...queueRef.current };
      setQueue(queueRef.current);
      drain();
    });
    return () => { alive = false; };
  }, [drain]);

  useEffect(() => {
    if (shift?.prep?.userId) drain();
  }, [shift?.prep?.userId, drain]);

  useEffect(() => {
    const retryWaiting = () => {
      const waiting = Object.values(queueRef.current).filter((e) => e.status === 'waiting');
      if (!waiting.length) return;
      const next = { ...queueRef.current };
      for (const e of waiting) next[e.key] = { ...e, status: 'pending' };
      commitQueue(next);
      drain();
    };
    const t = setInterval(retryWaiting, 20000);
    window.addEventListener('online', retryWaiting);
    return () => { clearInterval(t); window.removeEventListener('online', retryWaiting); };
  }, [commitQueue, drain]);

  const newEntry = (line, shipmentId, shelf) => ({
    key: entryKey(line.id, shelf), lineId: line.id, shipmentId, shelf: shelf || null,
    actorId: shiftRef.current?.prep?.userId, createdAt: Date.now(),
    pendingDelta: 0, pendingSet: null, inflightTarget: null, status: 'pending', error: null, message: null,
  });
  const clearResult = (lineId) => setResults((m) => { if (!m[lineId]) return m; const { [lineId]: _x, ...rest } = m; return rest; });
  const entriesOf = (q, lineId) => Object.values(q).filter((e) => e.lineId === lineId);

  // `shelf` defaults to the active shelf; undo passes the shelf the units
  // were scanned to, so they come back off that one.
  const addUnits = useCallback((line, n = 1, { undoable = true, shelf } = {}) => {
    const shipmentId = currentIdRef.current;
    if (!shipmentId || !n) return;
    const target = shelf === undefined ? activeShelfRef.current : shelf;
    updateEntry(entryKey(line.id, target), (e) => {
      const base = e || newEntry(line, shipmentId, target);
      return { ...base, pendingDelta: base.pendingDelta + n, status: base.status === 'sending' ? 'sending' : 'pending', error: null };
    });
    clearResult(line.id);
    if (undoable) {
      undoStackRef.current = [...undoStackRef.current.slice(-49), { lineId: line.id, name: line.name, n, line, shelf: target }];
      setUndoTop(undoStackRef.current[undoStackRef.current.length - 1]);
    }
    drain();
  }, [updateEntry, drain]);

  // A typed total replaces whatever this phone had not sent yet for the line.
  const setUnits = useCallback((line, value) => {
    const shipmentId = currentIdRef.current;
    if (!shipmentId) return;
    const v = Math.max(0, Math.floor(Number(value) || 0));
    const shelf = activeShelfRef.current;
    const key = entryKey(line.id, shelf);
    const next = { ...queueRef.current };
    for (const e of entriesOf(next, line.id)) {
      if (e.key !== key && e.inflightTarget == null && e.status !== 'sending') delete next[e.key];
    }
    const base = next[key] || newEntry(line, shipmentId, shelf);
    next[key] = { ...base, pendingSet: v, pendingDelta: 0, status: base.status === 'sending' ? 'sending' : 'pending', error: null, updatedAt: Date.now() };
    commitQueue(next);
    clearResult(line.id);
    // Scan-undo stops at a typed count.
    undoStackRef.current = undoStackRef.current.filter((a) => a.lineId !== line.id);
    setUndoTop(undoStackRef.current[undoStackRef.current.length - 1] || null);
    drain();
  }, [commitQueue, drain]);

  const undoLast = useCallback(() => {
    const last = undoStackRef.current[undoStackRef.current.length - 1];
    if (!last) return null;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    setUndoTop(undoStackRef.current[undoStackRef.current.length - 1] || null);
    addUnits(last.line, -last.n, { undoable: false, shelf: last.shelf || null });
    return last;
  }, [addUnits]);

  const retryLine = useCallback((lineId) => {
    const next = { ...queueRef.current };
    for (const e of entriesOf(next, lineId)) if (e.status === 'error') next[e.key] = { ...e, status: 'pending', error: null };
    commitQueue(next);
    drain();
  }, [commitQueue, drain]);

  // Gives up on what this phone still had to send for a line, and shows the
  // Prep-Center's own count again.
  const discardLine = useCallback((lineId) => {
    const next = { ...queueRef.current };
    for (const e of entriesOf(next, lineId)) delete next[e.key];
    commitQueue(next);
    undoStackRef.current = undoStackRef.current.filter((a) => a.lineId !== lineId);
    setUndoTop(undoStackRef.current[undoStackRef.current.length - 1] || null);
    if (currentIdRef.current) {
      const id = currentIdRef.current;
      withPrep((t) => rx.loadReception(t, id)).then((res) => {
        if (res.ok && currentIdRef.current === id) setCurrent((c) => ({ ...c, reception: res.reception }));
      });
    }
  }, [commitQueue, withPrep]);

  /** The entry that best describes a line's sync state (an error beats waiting beats sending). */
  const lineEntry = useCallback((lineId) => entriesOf(queue, lineId)
    .sort((a, b) => (STATUS_RANK[b.status] || 0) - (STATUS_RANK[a.status] || 0))[0] || null, [queue]);

  // Counts this operator still has to send (End shift warns about them).
  const pendingCount = useMemo(
    () => Object.values(queue).filter((e) => e.actorId === shift?.prep?.userId).length,
    [queue, shift?.prep?.userId],
  );

  /** What the operator should see for a line: the Prep-Center's count plus anything not sent yet. */
  const shownReceived = useCallback((line) => {
    let v = line.received;
    for (const e of entriesOf(queue, line.id).sort(byCreation)) {
      if (e.inflightTarget != null) v = e.inflightTarget;
      if (e.pendingSet != null) v = e.pendingSet;
      v += e.pendingDelta;
    }
    return Math.max(0, v);
  }, [queue]);

  const value = useMemo(() => ({
    country, open, refreshOpen, lookup, looking, lookupTracking, searchReceptions, clearLookup, lookupHandover, sendNote,
    current, openReception, reloadCurrent,
    queue, lineEntry, results, shownReceived, addUnits, setUnits, undoLast, undoTop, retryLine, discardLine, pendingCount,
    activeShelf, defaultShelf, setShelfByCode, clearShelf,
  }), [country, open, refreshOpen, lookup, looking, lookupTracking, searchReceptions, clearLookup, lookupHandover, sendNote, current, openReception, reloadCurrent,
    queue, lineEntry, results, shownReceived, addUnits, setUnits, undoLast, undoTop, retryLine, discardLine, pendingCount,
    activeShelf, defaultShelf, setShelfByCode, clearShelf]);

  return <RecvCtx.Provider value={value}>{children}</RecvCtx.Provider>;
}

export function useReceiving() {
  const ctx = useContext(RecvCtx);
  if (!ctx) throw new Error('useReceiving must be used inside ReceivingProvider');
  return ctx;
}
