import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';

// Operators are Prep-Center staff accounts and sign in with their Prep-Center
// email and password at the start of every shift (plus their authenticator
// code if they use one). Name, country and permissions come from the
// Prep-Center profile, never typed here. The email last used on this phone is
// filled in.

// Why a login was refused, in the operator's terms.
const REASONS = {
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

export default function Login() {
  const { prepSignIn, prepVerifyMfa, prepChooseCountry, prepOperators } = useApp();
  const lastEmail = useMemo(() => Object.values(prepOperators || {})
    .sort((a, b) => String(b.linkedAt || '').localeCompare(String(a.linkedAt || '')))[0]?.email || '', [prepOperators]);
  const [busy, setBusy] = useState(false);
  // What the screen is asking for. null = email and password.
  //   { kind: 'mfa', pending, error }
  //   { kind: 'country', pending, countries }
  const [step, setStep] = useState(null);
  const [error, setError] = useState(null);
  const [email, setEmail] = useState(lastEmail);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  // Any answer from the context: either the shift started (the app moves on
  // by itself) or the next thing to ask for.
  const follow = (res) => {
    if (res.ok) { setStep(null); setError(null); return; }
    if (res.reason === 'mfa') {
      setCode('');
      setError(null);
      setStep({ kind: 'mfa', pending: res.pending });
    } else if (res.reason === 'chooseCountry') {
      setError(null);
      setStep({ kind: 'country', pending: res.pending, countries: res.countries });
    } else {
      setStep((s) => (s?.kind === 'mfa' && res.reason === 'badMfaCode' ? s : null));
      setError(res.reason);
    }
  };

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { follow(await fn()); } finally { setBusy(false); }
  };

  const submitSignIn = (e) => {
    e?.preventDefault();
    if (!email.trim() || !password) return;
    run(() => prepSignIn({ email: email.trim(), password }));
  };

  const submitMfa = (e) => {
    e?.preventDefault();
    if (!code.trim()) return;
    const { pending } = step;
    run(() => prepVerifyMfa(pending, code));
  };

  const cancel = () => { setStep(null); setError(null); setPassword(''); };
  const errorLine = error && <div className="text-[13px] font-bold text-white">{REASONS[error] || REASONS.authFailed}</div>;

  return (
    <div
      className="relative flex h-full flex-col justify-center gap-[22px] overflow-y-auto px-6 py-[30px] text-white safe-top safe-bottom"
      style={{ background: 'linear-gradient(160deg,#1F6FEB 0%,#0969DA 60%,#0B378E 100%)' }}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-white text-[15px] font-extrabold text-primary">W</div>
        <div>
          <div className="text-[15px] font-extrabold tracking-[-.01em]">WMS App</div>
          <div className="text-[9px] uppercase tracking-[.14em] text-white/70">Warehouse scan</div>
        </div>
      </div>

      {step?.kind === 'mfa' ? (
        <form onSubmit={submitMfa} className="flex flex-col gap-3">
          <div>
            <div className="text-[20px] font-extrabold leading-[1.25] tracking-[-.02em]">Authenticator code</div>
            <div className="mt-2 text-[13px] text-white/75">Enter the 6-digit code from your authenticator app, as on the Prep-Center website.</div>
          </div>
          <input
            autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={8}
            value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))} placeholder="123456"
            className={`${inputCls} text-center font-mono text-[20px] tracking-[.3em]`}
          />
          {errorLine}
          <button type="submit" disabled={busy || code.length < 6} className={primaryBtn}>
            {busy ? 'Checking…' : 'Confirm'}
          </button>
          <button type="button" onClick={cancel} disabled={busy} className={linkBtn}>Cancel</button>
        </form>
      ) : step?.kind === 'country' ? (
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[20px] font-extrabold leading-[1.25] tracking-[-.02em]">Which warehouse?</div>
            <div className="mt-2 text-[13px] text-white/75">Your account covers more than one country. Choose where this shift is.</div>
          </div>
          {step.countries.map((c) => (
            <button key={c} onClick={() => follow(prepChooseCountry(step.pending, c))} className={primaryBtn}>
              {COUNTRY_NAMES[c] || c} · {c}
            </button>
          ))}
          <button type="button" onClick={cancel} className={linkBtn}>Cancel</button>
        </div>
      ) : (
        <form onSubmit={submitSignIn} className="flex flex-col gap-3">
          <div>
            <div className="text-[22px] font-extrabold leading-[1.25] tracking-[-.02em]">Sign in to start the shift</div>
            <div className="mt-2 text-[13px] text-white/75">Use your Prep-Center email and password.</div>
          </div>
          <input
            type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false}
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Prep-Center email" className={inputCls}
          />
          <input
            type="password" autoComplete="current-password" autoFocus={!!lastEmail}
            value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className={inputCls}
          />
          {errorLine}
          <button type="submit" disabled={busy || !email.trim() || !password} className={primaryBtn}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      )}
    </div>
  );
}
