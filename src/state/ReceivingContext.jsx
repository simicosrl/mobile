import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppContext';
import * as rx from '../lib/prepReceiving';
import { readReceivedUnits, setReceivedUnits } from '../lib/prepReceivingSave';
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
  const updateEntry = useCallback((lineId, fn) => {
    const nextEntry = fn(queueRef.current[lineId] || null);
    const next = { ...queueRef.current };
    if (nextEntry) next[lineId] = { ...nextEntry, updatedAt: Date.now() };
    else delete next[lineId];
    commitQueue(next);
  }, [commitQueue]);

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
    // A different reception starts a fresh undo history.
    if (currentIdRef.current !== id) {
      undoStackRef.current = [];
      setUndoTop(null);
    }
    currentIdRef.current = id;
    setCurrent((c) => ({ id, reception: c.id === id ? c.reception : null, loading: true, error: null }));
    setScreen('recvOrder');
    const res = await withPrep((t) => rx.loadReception(t, id));
    if (currentIdRef.current !== id) return; // the operator moved on meanwhile
    setCurrent((c) => (res.ok
      ? { id, reception: res.reception, loading: false, error: null }
      : { ...c, loading: false, error: res.reason }));
  }, [withPrep, setScreen]);

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
          .sort((a, b) => a.updatedAt - b.updatedAt)[0];
        if (!entry) break;
        const { lineId, shipmentId } = entry;

        let target = entry.inflightTarget;
        if (target == null) {
          if (entry.pendingSet != null) {
            target = entry.pendingSet + entry.pendingDelta;
          } else {
            const r = await withPrep((t) => readReceivedUnits(t, lineId));
            if (!r.ok) {
              const soft = ['offline', 'expired', 'unauthorized', 'notSignedIn'].includes(r.reason);
              updateEntry(lineId, (e) => e && { ...e, status: soft ? 'waiting' : 'error', error: r.reason, message: r.message || null });
              continue;
            }
            target = r.received + entry.pendingDelta;
          }
          target = Math.max(0, target);
          const fixed = target;
          updateEntry(lineId, (e) => e && { ...e, inflightTarget: fixed, pendingSet: null, pendingDelta: 0, status: 'sending', error: null });
        } else {
          updateEntry(lineId, (e) => e && { ...e, status: 'sending', error: null });
        }

        const res = await withPrep((t) => setReceivedUnits(t, { shipmentId, itemId: lineId, target, actorId, country: shiftCountry }));
        touchedShipments.add(shipmentId);
        if (res.ok) {
          applyServerReceived(lineId, res.received);
          if (!res.unchanged) setResults((m) => ({ ...m, [lineId]: { placedOn: res.placedOn || null, placementError: res.placementError || null } }));
          updateEntry(lineId, (e) => {
            if (!e) return null;
            const rest = { ...e, inflightTarget: null, status: 'pending', error: null, message: null };
            return rest.pendingDelta === 0 && rest.pendingSet == null ? null : rest;
          });
        } else if (['offline', 'expired', 'unauthorized', 'notSignedIn'].includes(res.reason)) {
          updateEntry(lineId, (e) => e && { ...e, status: 'waiting', error: res.reason });
        } else if (res.reason === 'belowAssigned') {
          // Nothing was written. Show the Prep-Center's count and why.
          if (res.received != null) applyServerReceived(lineId, res.received);
          setResults((m) => ({ ...m, [lineId]: { belowAssigned: res.assigned } }));
          updateEntry(lineId, (e) => {
            if (!e) return null;
            const rest = { ...e, inflightTarget: null, status: 'pending', error: null };
            return rest.pendingDelta === 0 && rest.pendingSet == null ? null : rest;
          });
        } else {
          updateEntry(lineId, (e) => e && { ...e, status: 'error', error: res.reason, message: res.message || null });
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
      const restored = Object.fromEntries(Object.entries(saved).map(([k, e]) => [k, { ...e, status: e.status === 'error' ? 'error' : 'pending' }]));
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
      for (const e of waiting) next[e.lineId] = { ...e, status: 'pending' };
      commitQueue(next);
      drain();
    };
    const t = setInterval(retryWaiting, 20000);
    window.addEventListener('online', retryWaiting);
    return () => { clearInterval(t); window.removeEventListener('online', retryWaiting); };
  }, [commitQueue, drain]);

  const newEntry = (line, shipmentId) => ({
    lineId: line.id, shipmentId, actorId: shiftRef.current?.prep?.userId,
    pendingDelta: 0, pendingSet: null, inflightTarget: null, status: 'pending', error: null, message: null,
  });

  const addUnits = useCallback((line, n = 1, { undoable = true } = {}) => {
    const shipmentId = currentIdRef.current;
    if (!shipmentId || !n) return;
    updateEntry(line.id, (e) => {
      const base = e || newEntry(line, shipmentId);
      return { ...base, pendingDelta: base.pendingDelta + n, status: base.status === 'sending' ? 'sending' : 'pending', error: null };
    });
    setResults((m) => { if (!m[line.id]) return m; const { [line.id]: _x, ...rest } = m; return rest; });
    if (undoable) {
      undoStackRef.current = [...undoStackRef.current.slice(-49), { lineId: line.id, name: line.name, n, line }];
      setUndoTop(undoStackRef.current[undoStackRef.current.length - 1]);
    }
    drain();
  }, [updateEntry, drain]);

  const setUnits = useCallback((line, value) => {
    const shipmentId = currentIdRef.current;
    if (!shipmentId) return;
    const v = Math.max(0, Math.floor(Number(value) || 0));
    updateEntry(line.id, (e) => {
      const base = e || newEntry(line, shipmentId);
      return { ...base, pendingSet: v, pendingDelta: 0, status: base.status === 'sending' ? 'sending' : 'pending', error: null };
    });
    setResults((m) => { if (!m[line.id]) return m; const { [line.id]: _x, ...rest } = m; return rest; });
    // A typed count replaces what was scanned before it; scan-undo stops here.
    undoStackRef.current = undoStackRef.current.filter((a) => a.lineId !== line.id);
    setUndoTop(undoStackRef.current[undoStackRef.current.length - 1] || null);
    drain();
  }, [updateEntry, drain]);

  const undoLast = useCallback(() => {
    const last = undoStackRef.current[undoStackRef.current.length - 1];
    if (!last) return null;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    setUndoTop(undoStackRef.current[undoStackRef.current.length - 1] || null);
    addUnits(last.line, -last.n, { undoable: false });
    return last;
  }, [addUnits]);

  const retryLine = useCallback((lineId) => {
    updateEntry(lineId, (e) => e && { ...e, status: 'pending', error: null });
    drain();
  }, [updateEntry, drain]);

  // Gives up on what this phone still had to send for a line, and shows the
  // Prep-Center's own count again.
  const discardLine = useCallback((lineId) => {
    updateEntry(lineId, () => null);
    undoStackRef.current = undoStackRef.current.filter((a) => a.lineId !== lineId);
    setUndoTop(undoStackRef.current[undoStackRef.current.length - 1] || null);
    if (currentIdRef.current) {
      const id = currentIdRef.current;
      withPrep((t) => rx.loadReception(t, id)).then((res) => {
        if (res.ok && currentIdRef.current === id) setCurrent((c) => ({ ...c, reception: res.reception }));
      });
    }
  }, [updateEntry, withPrep]);

  // Counts this operator still has to send (End shift warns about them).
  const pendingCount = useMemo(
    () => Object.values(queue).filter((e) => e.actorId === shift?.prep?.userId).length,
    [queue, shift?.prep?.userId],
  );

  /** What the operator should see for a line: the Prep-Center's count plus anything not sent yet. */
  const shownReceived = useCallback((line) => {
    const e = queue[line.id];
    if (!e) return line.received;
    const base = e.inflightTarget ?? line.received;
    return Math.max(0, (e.pendingSet ?? base) + e.pendingDelta);
  }, [queue]);

  const value = useMemo(() => ({
    country, open, refreshOpen, lookup, looking, lookupTracking, searchReceptions, clearLookup,
    current, openReception, reloadCurrent,
    queue, results, shownReceived, addUnits, setUnits, undoLast, undoTop, retryLine, discardLine, pendingCount,
  }), [country, open, refreshOpen, lookup, looking, lookupTracking, searchReceptions, clearLookup, current, openReception, reloadCurrent,
    queue, results, shownReceived, addUnits, setUnits, undoLast, undoTop, retryLine, discardLine, pendingCount]);

  return <RecvCtx.Provider value={value}>{children}</RecvCtx.Provider>;
}

export function useReceiving() {
  const ctx = useContext(RecvCtx);
  if (!ctx) throw new Error('useReceiving must be used inside ReceivingProvider');
  return ctx;
}
