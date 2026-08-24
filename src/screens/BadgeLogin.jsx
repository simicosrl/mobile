import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext';
import { kvGet, kvSet } from '../lib/db';
import { ScanLine, ArrowRight, Camera } from '../components/icons';
import { useBarcodeScanner, isCameraScanSupported } from '../hooks/useBarcodeScanner';

// Badge login is scan-only, by design — no manual entry. A hardware
// keyboard-wedge scanner (Zebra engine or Bluetooth ring scanner) types
// into a hidden, always-focused input and submits on Enter automatically.
// Phones/tablets with no scanner attached use the camera button, which
// opens the native ML Kit scanner (see hooks/useBarcodeScanner.js).
export default function BadgeLogin() {
  const { loginWithBadge } = useApp();
  const [pendingBadge, setPendingBadge] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  // { badgeId, reason: 'unassigned' | 'offline' } | null — country is
  // looked up server-side on every login now (no more manual picker), so a
  // badge with nothing assigned yet, or a lookup that couldn't be reached at
  // all, both need to block here rather than let the operator through.
  const [loginError, setLoginError] = useState(null);
  const hiddenRef = useRef(null);
  const debounceRef = useRef(null);
  const { scan, scanning, error } = useBarcodeScanner();

  useEffect(() => {
    const refocus = () => {
      if (!pendingBadge && !busy && !loginError && hiddenRef.current && document.activeElement !== hiddenRef.current) {
        try { hiddenRef.current.focus({ preventScroll: true }); } catch { /* ignore */ }
      }
    };
    refocus();
    const t = setInterval(refocus, 400);
    return () => clearInterval(t);
  }, [pendingBadge, busy, loginError]);

  const attemptLogin = async (badgeId, operatorName) => {
    setBusy(true);
    const res = await loginWithBadge(badgeId, operatorName);
    setBusy(false);
    if (!res.ok) setLoginError({ badgeId, reason: res.reason });
  };

  const handleBadge = async (raw) => {
    // Re-entrancy guard — the hidden input stays live (and its 400ms
    // no-terminator fallback can still fire) while a lookup is in flight;
    // without this a second scan mid-await would fire an overlapping login.
    if (busy) return;
    const badgeId = String(raw || '').trim().toUpperCase();
    if (!badgeId) return;
    setLoginError(null);
    const knownNames = (await kvGet('badgeNames', {})) || {};
    if (knownNames[badgeId]) {
      await attemptLogin(badgeId, knownNames[badgeId]);
    } else {
      setPendingBadge(badgeId);
    }
  };

  const scanWithCamera = async () => {
    const code = await scan();
    if (code) handleBadge(code);
  };

  const confirmName = async () => {
    if (busy || !pendingBadge || name.trim().length < 2) return;
    const knownNames = (await kvGet('badgeNames', {})) || {};
    knownNames[pendingBadge] = name.trim();
    await kvSet('badgeNames', knownNames);
    await attemptLogin(pendingBadge, name.trim());
  };

  const tryAgain = () => {
    setLoginError(null);
    setPendingBadge(null);
    setName('');
  };

  return (
    <div
      className="relative flex h-full flex-col justify-center gap-[22px] px-6 py-[30px] text-white safe-top safe-bottom"
      style={{ background: 'linear-gradient(160deg,#1F6FEB 0%,#0969DA 60%,#0B378E 100%)' }}
    >
      <input
        ref={hiddenRef}
        defaultValue=""
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          handleBadge(e.target.value);
          e.target.value = '';
          clearTimeout(debounceRef.current);
        }}
        onInput={(e) => {
          const val = e.target.value;
          if (val.includes('\n')) {
            handleBadge(val.replace('\n', ''));
            e.target.value = '';
            clearTimeout(debounceRef.current);
            return;
          }
          // Fallback for scanners/DataWedge configs that commit the scanned
          // text without any Enter/newline terminator at all: submit once
          // the value has stopped changing for a moment. 400ms is well past
          // a scanner's burst-typed characters, but still short enough not
          // to feel laggy if this genuinely needs to fire.
          clearTimeout(debounceRef.current);
          if (val) {
            debounceRef.current = setTimeout(() => {
              handleBadge(e.target.value);
              e.target.value = '';
            }, 400);
          }
        }}
        className="absolute h-px w-px opacity-0"
        aria-hidden="true"
        tabIndex={-1}
      />

      <div className="flex items-center gap-2.5">
        <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-white text-[15px] font-extrabold text-primary">W</div>
        <div>
          <div className="text-[15px] font-extrabold tracking-[-.01em]">WMS App</div>
          <div className="text-[9px] uppercase tracking-[.14em] text-white/70">Warehouse scan</div>
        </div>
      </div>

      {loginError ? (
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[20px] font-extrabold leading-[1.25] tracking-[-.02em]">Badge {loginError.badgeId}</div>
            {loginError.reason === 'unassigned' ? (
              <div className="mt-2 text-[13px] text-white/75">
                This badge has no country assigned yet. Contact the office to get it set up before scanning.
              </div>
            ) : (
              <div className="mt-2 text-[13px] text-white/75">
                Couldn't reach the server to check this badge — check the connection and try again.
              </div>
            )}
          </div>
          <button
            onClick={tryAgain}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-white text-[15px] font-extrabold text-primary"
          >
            Try again
          </button>
        </div>
      ) : !pendingBadge ? (
        <>
          <div>
            <div className="text-[22px] font-extrabold leading-[1.25] tracking-[-.02em]">Scan your badge to start the shift</div>
            <div className="mt-2 text-[13px] text-white/75">Point the scanner at the badge barcode. One scan per shift.</div>
          </div>
          <div className="flex flex-col items-center gap-2.5 rounded-[14px] border-2 border-dashed border-white/40 p-5">
            <ScanLine size={34} strokeWidth={1.6} className="text-white/90" />
            <div className="font-mono text-xs uppercase tracking-[.08em] text-white/65">
              {busy ? 'Checking badge…' : 'Waiting for badge…'}
            </div>
          </div>
          {isCameraScanSupported() && (
            <button
              onClick={scanWithCamera}
              disabled={scanning || busy}
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-white text-[15px] font-extrabold text-primary disabled:opacity-60"
            >
              <Camera size={18} strokeWidth={2} /> {scanning ? 'Opening camera…' : 'No Zebra scanner — scan with camera'}
            </button>
          )}
          {error && <div className="text-center text-[12px] text-white/80">{error}</div>}
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[20px] font-extrabold leading-[1.25] tracking-[-.02em]">Badge {pendingBadge}</div>
            <div className="mt-2 text-[13px] text-white/75">First time we've seen this badge — what's your name?</div>
          </div>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') confirmName(); }}
            placeholder="Full name"
            className="min-h-[50px] w-full rounded-xl border border-white/35 bg-white/10 px-4 text-[15px] text-white placeholder:text-white/50"
          />
          <button
            onClick={confirmName}
            disabled={name.trim().length < 2 || busy}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-white text-[15px] font-extrabold text-primary disabled:opacity-50"
          >
            {busy ? 'Checking…' : (<>Start shift <ArrowRight size={17} strokeWidth={2.2} /></>)}
          </button>
        </div>
      )}
    </div>
  );
}
