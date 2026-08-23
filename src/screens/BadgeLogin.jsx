import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext';
import { kvGet, kvSet } from '../lib/db';
import { ScanLine, ArrowRight, Camera } from '../components/icons';
import { useBarcodeScanner, isBarcodeDetectionSupported } from '../hooks/useBarcodeScanner';

// Badge scan is hardware-scanner-first: a keyboard-wedge scanner (Zebra
// engine or a Bluetooth ring scanner) types into a hidden, always-focused
// input and submits on Enter — no UI needed for that path. Phones/tablets
// with no scanner attached get a camera-based scan option (when the
// device/browser supports it) plus a manual entry fallback either way.
export default function BadgeLogin() {
  const { loginWithBadge } = useApp();
  const [pendingBadge, setPendingBadge] = useState(null);
  const [name, setName] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const hiddenRef = useRef(null);

  const scanner = useBarcodeScanner((code) => {
    setCameraOpen(false);
    handleBadge(code);
  });

  useEffect(() => {
    const refocus = () => {
      if (!pendingBadge && !cameraOpen && hiddenRef.current && document.activeElement !== hiddenRef.current) {
        try { hiddenRef.current.focus({ preventScroll: true }); } catch { /* ignore */ }
      }
    };
    refocus();
    const t = setInterval(refocus, 400);
    return () => clearInterval(t);
  }, [pendingBadge, cameraOpen]);

  useEffect(() => {
    if (cameraOpen) scanner.start();
    else scanner.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen]);

  const handleBadge = async (raw) => {
    const badgeId = String(raw || '').trim().toUpperCase();
    if (!badgeId) return;
    const knownNames = (await kvGet('badgeNames', {})) || {};
    if (knownNames[badgeId]) {
      loginWithBadge(badgeId, knownNames[badgeId]);
    } else {
      setPendingBadge(badgeId);
    }
  };

  const confirmName = async () => {
    if (!pendingBadge || name.trim().length < 2) return;
    const knownNames = (await kvGet('badgeNames', {})) || {};
    knownNames[pendingBadge] = name.trim();
    await kvSet('badgeNames', knownNames);
    loginWithBadge(pendingBadge, name.trim());
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
        }}
        onInput={(e) => {
          if (e.target.value.includes('\n')) {
            handleBadge(e.target.value.replace('\n', ''));
            e.target.value = '';
          }
        }}
        className="absolute h-px w-px opacity-0"
        aria-hidden="true"
        tabIndex={-1}
      />

      <div className="flex items-center gap-2.5">
        <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-white text-[15px] font-extrabold text-primary">S</div>
        <div>
          <div className="text-[15px] font-extrabold tracking-[-.01em]">SIMICO</div>
          <div className="text-[9px] uppercase tracking-[.14em] text-white/70">Warehouse scan</div>
        </div>
      </div>

      {!pendingBadge ? (
        <>
          <div>
            <div className="text-[22px] font-extrabold leading-[1.25] tracking-[-.02em]">Scan your badge to start the shift</div>
            <div className="mt-2 text-[13px] text-white/75">Point the scanner at the badge barcode. One scan per shift.</div>
          </div>
          <div className="flex flex-col items-center gap-2.5 rounded-[14px] border-2 border-dashed border-white/40 p-5">
            <ScanLine size={34} strokeWidth={1.6} className="text-white/90" />
            <div className="font-mono text-xs uppercase tracking-[.08em] text-white/65">Waiting for badge…</div>
          </div>
          {isBarcodeDetectionSupported() && (
            <button
              onClick={() => setCameraOpen(true)}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-white/35 bg-white/10 text-[13px] font-bold text-white"
            >
              <Camera size={17} strokeWidth={2} /> No Zebra scanner — use phone camera
            </button>
          )}
          {!manualOpen ? (
            <button onClick={() => setManualOpen(true)} className="text-center text-[12.5px] font-bold text-white/80 underline underline-offset-2">
              Enter badge ID manually instead
            </button>
          ) : (
            <div className="flex gap-2">
              <input
                autoFocus
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleBadge(manualValue); }}
                placeholder="BADGE-0000"
                className="min-h-[48px] flex-1 rounded-xl border border-white/35 bg-white/10 px-4 font-mono text-sm text-white placeholder:text-white/50"
              />
              <button
                onClick={() => handleBadge(manualValue)}
                className="flex min-h-[48px] items-center justify-center rounded-xl bg-white px-4 font-extrabold text-primary"
              >
                Go
              </button>
            </div>
          )}
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
            disabled={name.trim().length < 2}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-white text-[15px] font-extrabold text-primary disabled:opacity-50"
          >
            Start shift <ArrowRight size={17} strokeWidth={2.2} />
          </button>
        </div>
      )}

      {cameraOpen && (
        <div className="absolute inset-0 z-30 flex flex-col bg-black">
          <video ref={scanner.videoRef} className="flex-1 object-cover" playsInline muted />
          <div className="flex flex-col gap-2 p-4">
            {scanner.error && <div className="text-center text-sm text-white">{scanner.error}</div>}
            <button onClick={() => setCameraOpen(false)} className="min-h-[48px] rounded-xl bg-white text-sm font-bold text-ink">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
