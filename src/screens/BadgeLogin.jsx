import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext';
import { ScanLine, Camera } from '../components/icons';
import { useBarcodeScanner, isCameraScanSupported } from '../hooks/useBarcodeScanner';

// Badge login is scan-only, by design — no manual entry of any kind, and no
// on-screen keyboard should ever appear on this screen. A hardware
// keyboard-wedge scanner (Zebra engine or Bluetooth ring scanner) types
// into a hidden, always-focused input and submits on Enter automatically;
// `inputMode="none"` on that input is what actually keeps the software
// keyboard from popping up on a touchscreen device that focuses it —
// hiding the input visually (opacity/size) does nothing to stop that on
// its own, since a focused, editable text input still asks the OS for its
// on-screen keyboard regardless of how it's styled. Phones/tablets with no
// hardware scanner attached use the camera button instead, which opens the
// native ML Kit scanner (see hooks/useBarcodeScanner.js).
//
// Operators are Prep-Center staff accounts. A badge already linked on this
// phone signs straight in; the first scan of any other badge asks for that
// operator's Prep-Center email and password once (plus their authenticator
// code if they use one), then links the badge. That one-time form is the only
// place a keyboard appears. Name, country and permissions come from the
// Prep-Center profile, never typed here.

// Why a login was refused, in the operator's terms.
const REASONS = {
  unassigned: 'This badge has no country assigned yet. Contact the office to get it set up before scanning.',
  offline: "Couldn't reach the server — check the connection and try again.",
  badCredentials: 'Wrong email or password.',
  emailNotConfirmed: 'This Prep-Center account has not confirmed its email yet.',
  authFailed: "The Prep-Center didn't accept the sign-in.",
  badMfaCode: 'That code is not valid. Enter the current code from your authenticator app.',
  noProfile: 'No Prep-Center profile was found for this account.',
  inactive: 'This Prep-Center account is disabled. Contact the office.',
  notStaff: 'Only Prep-Center staff accounts can use this app.',
  noWarehousePermission: 'Your Prep-Center account does not have the Warehouse permission. Ask an administrator to grant it.',
  noCountry: 'Your Prep-Center profile has no warehouse country (IT, FR or DE). Ask an administrator to set it.',
  warehouseNetwork: 'Your account can only be used on the warehouse network. Connect to the warehouse Wi-Fi and try again.',
  warehouseNetworkUnverified: "Your account can only be used on the warehouse network, and that couldn't be checked. Connect to the warehouse Wi-Fi and try again.",
};
const COUNTRY_NAMES = { IT: 'Italy', FR: 'France', DE: 'Germany' };

const inputCls = 'min-h-[52px] w-full rounded-xl border-0 bg-white px-4 text-[15px] text-ink outline-none placeholder:text-secondary';
const primaryBtn = 'flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-white text-[15px] font-extrabold text-primary disabled:opacity-60';
const linkBtn = 'self-center text-[12.5px] font-bold text-white/80 underline underline-offset-2 disabled:opacity-60';

export default function BadgeLogin() {
  const { loginWithBadge, loginWithLegacyBadge, prepSignIn, prepVerifyMfa, prepChooseCountry } = useApp();
  const [busy, setBusy] = useState(false);
  // What the screen is asking for. null = waiting for a badge scan.
  //   { kind: 'error', badgeId, reason }
  //   { kind: 'signin', badgeId, email, expired, error }
  //   { kind: 'mfa', pending, error }
  //   { kind: 'country', pending, countries }
  const [step, setStep] = useState(null);
  const loginError = step?.kind === 'error' ? step : null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const hiddenRef = useRef(null);
  const debounceRef = useRef(null);
  const { scan, scanning, error } = useBarcodeScanner();

  useEffect(() => {
    const refocus = () => {
      if (!busy && !step && hiddenRef.current && document.activeElement !== hiddenRef.current) {
        try { hiddenRef.current.focus({ preventScroll: true }); } catch { /* ignore */ }
      }
    };
    refocus();
    const t = setInterval(refocus, 400);
    return () => clearInterval(t);
  }, [busy, step]);

  // Any answer from the context: either the shift started (the app moves on
  // by itself) or the next thing to ask for.
  const follow = (res, badgeId) => {
    if (res.ok) { setStep(null); return; }
    if (res.reason === 'needsPrepLogin') {
      setEmail(res.email || '');
      setPassword('');
      setStep({ kind: 'signin', badgeId: res.badgeId || badgeId, expired: !!res.expired });
    } else if (res.reason === 'mfa') {
      setCode('');
      setStep({ kind: 'mfa', pending: res.pending });
    } else if (res.reason === 'chooseCountry') {
      setStep({ kind: 'country', pending: res.pending, countries: res.countries });
    } else {
      setStep({ kind: 'error', badgeId, reason: res.reason });
    }
  };

  const run = async (fn, onError) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok && onError && ['badCredentials', 'badMfaCode', 'offline', 'authFailed', 'emailNotConfirmed'].includes(res.reason)) {
        onError(res.reason);
      } else {
        follow(res, step?.badgeId || step?.pending?.badgeId);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitSignIn = (e) => {
    e?.preventDefault();
    if (!email.trim() || !password) return;
    const badgeId = step.badgeId;
    run(() => prepSignIn({ badgeId, email, password }), (reason) => setStep((s) => ({ ...s, error: reason })));
  };

  const submitMfa = (e) => {
    e?.preventDefault();
    if (!code.trim()) return;
    const { pending } = step;
    run(() => prepVerifyMfa(pending, code), (reason) => setStep((s) => ({ ...s, error: reason })));
  };

  const useLegacy = () => {
    const badgeId = step.badgeId;
    run(() => loginWithLegacyBadge(badgeId));
  };

  const handleBadge = async (raw) => {
    // Re-entrancy guard — the hidden input stays live (and its 400ms
    // no-terminator fallback can still fire) while a lookup is in flight;
    // without this a second scan mid-await would fire an overlapping login.
    if (busy) return;
    const badgeId = String(raw || '').trim().toUpperCase();
    if (!badgeId) return;
    setStep(null);
    setBusy(true);
    try {
      follow(await loginWithBadge(badgeId), badgeId);
    } finally {
      setBusy(false);
    }
  };

  const scanWithCamera = async () => {
    const code = await scan();
    if (code) handleBadge(code);
  };

  const tryAgain = () => setStep(null);

  return (
    <div
      className="relative flex h-full flex-col justify-center gap-[22px] px-6 py-[30px] text-white safe-top safe-bottom"
      style={{ background: 'linear-gradient(160deg,#1F6FEB 0%,#0969DA 60%,#0B378E 100%)' }}
    >
      <input
        ref={hiddenRef}
        defaultValue=""
        // Suppresses the on-screen keyboard on a touchscreen device while
        // still accepting real keydown events from a hardware
        // keyboard-wedge scanner — those aren't affected by this hint.
        inputMode="none"
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

      {step?.kind === 'signin' ? (
        <form onSubmit={submitSignIn} className="flex flex-col gap-3">
          <div>
            <div className="text-[20px] font-extrabold leading-[1.25] tracking-[-.02em]">Badge {step.badgeId}</div>
            <div className="mt-2 text-[13px] text-white/75">
              {step.expired
                ? 'Your Prep-Center session on this phone has ended. Sign in again to continue.'
                : 'First time on this phone: sign in with your Prep-Center account. Next time, the badge is enough.'}
            </div>
          </div>
          <input
            type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false}
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Prep-Center email" className={inputCls}
          />
          <input
            type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className={inputCls}
          />
          {step.error && <div className="text-[13px] font-bold text-white">{REASONS[step.error] || REASONS.authFailed}</div>}
          <button type="submit" disabled={busy || !email.trim() || !password} className={primaryBtn}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <button type="button" onClick={tryAgain} disabled={busy} className={linkBtn}>Cancel</button>
          <button type="button" onClick={useLegacy} disabled={busy} className={linkBtn}>Use the old badge login instead</button>
        </form>
      ) : step?.kind === 'mfa' ? (
        <form onSubmit={submitMfa} className="flex flex-col gap-3">
          <div>
            <div className="text-[20px] font-extrabold leading-[1.25] tracking-[-.02em]">Authenticator code</div>
            <div className="mt-2 text-[13px] text-white/75">Enter the 6-digit code from your authenticator app, as on the Prep-Center website.</div>
          </div>
          <input
            inputMode="numeric" autoComplete="one-time-code" maxLength={8}
            value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))} placeholder="123456"
            className={`${inputCls} text-center font-mono text-[20px] tracking-[.3em]`}
          />
          {step.error && <div className="text-[13px] font-bold text-white">{REASONS[step.error] || REASONS.authFailed}</div>}
          <button type="submit" disabled={busy || code.length < 6} className={primaryBtn}>
            {busy ? 'Checking…' : 'Confirm'}
          </button>
          <button type="button" onClick={tryAgain} disabled={busy} className={linkBtn}>Cancel</button>
        </form>
      ) : step?.kind === 'country' ? (
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[20px] font-extrabold leading-[1.25] tracking-[-.02em]">Which warehouse?</div>
            <div className="mt-2 text-[13px] text-white/75">Your account covers more than one country. Choose where this shift is.</div>
          </div>
          {step.countries.map((c) => (
            <button key={c} onClick={() => follow(prepChooseCountry(step.pending, c), step.pending.badgeId)} className={primaryBtn}>
              {COUNTRY_NAMES[c] || c} · {c}
            </button>
          ))}
          <button type="button" onClick={tryAgain} className={linkBtn}>Cancel</button>
        </div>
      ) : loginError ? (
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[20px] font-extrabold leading-[1.25] tracking-[-.02em]">Badge {loginError.badgeId}</div>
            <div className="mt-2 text-[13px] text-white/75">{REASONS[loginError.reason] || REASONS.authFailed}</div>
          </div>
          <button
            onClick={tryAgain}
            className={primaryBtn}
          >
            Try again
          </button>
        </div>
      ) : (
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
      )}
    </div>
  );
}
