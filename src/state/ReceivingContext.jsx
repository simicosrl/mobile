import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useApp } from './AppContext';
import * as rx from '../lib/prepReceiving';

// Receiving ("Recepție marfă") state, kept apart from AppContext, which already
// carries the courier handover flow. Everything here is read from the
// Prep-Center with the operator's own session (see lib/prepReceiving.js).

const RecvCtx = createContext(null);

// What the operator is told when a Prep-Center call fails.
export function recvErrorText(reason) {
  if (reason === 'offline') return "Can't reach the Prep-Center — check the connection.";
  if (reason === 'expired') return 'Your Prep-Center session has ended. End the shift and scan your badge to sign in again.';
  if (reason === 'notSignedIn') return 'Receiving needs a Prep-Center sign-in. End the shift and scan your badge.';
  if (reason === 'notFound') return 'This reception no longer exists on the Prep-Center.';
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

  const refreshOpen = useCallback(async () => {
    if (!country) return;
    setOpen((o) => ({ ...o, loading: true, error: null }));
    const res = await withPrep((t) => rx.listOpenReceptions(t, country));
    setOpen((o) => (res.ok
      ? { rows: res.rows, loading: false, error: null, loadedAt: Date.now() }
      : { ...o, loading: false, error: res.reason }));
  }, [country, withPrep]);

  const openReception = useCallback(async (id) => {
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

  const value = useMemo(() => ({
    country, open, refreshOpen, lookup, looking, lookupTracking, searchReceptions, clearLookup,
    current, openReception, reloadCurrent,
  }), [country, open, refreshOpen, lookup, looking, lookupTracking, searchReceptions, clearLookup, current, openReception, reloadCurrent]);

  return <RecvCtx.Provider value={value}>{children}</RecvCtx.Provider>;
}

export function useReceiving() {
  const ctx = useContext(RecvCtx);
  if (!ctx) throw new Error('useReceiving must be used inside ReceivingProvider');
  return ctx;
}
