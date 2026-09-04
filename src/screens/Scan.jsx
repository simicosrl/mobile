import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { useApp } from '../state/AppContext';
import { docNumber, elapsedLabel } from '../lib/format';
import { Check, TriangleAlert, ScanLine, Trash2, PenLine, Camera, X, Keyboard as KeyboardIcon } from '../components/icons';
import { useBarcodeScanner, isCameraScanSupported } from '../hooks/useBarcodeScanner';

export default function Scan() {
  const app = useApp();
  const {
    direction, carrier, parcels, sessionStartedAt, flash,
    submitScan, removeLast, removeParcel, openDamage, toSign, docSeq, openPhoto,
  } = app;
  const isOut = direction === 'out';
  const nextDoc = docNumber(direction, docSeq[direction]);
  const last = parcels.length ? parcels[parcels.length - 1] : null;
  const [buffer, setBuffer] = useState('');
  const inputRef = useRef(null);
  const { scan, scanning, error: scanError } = useBarcodeScanner();
  // The tracking field stays auto-focused so a hardware scanner-wedge can
  // always type into it (DataWedge injects text via the field's
  // InputConnection regardless of whether the on-screen keyboard is
  // visible), but the on-screen keyboard should only ever appear because
  // the operator explicitly asked for it via the Keyboard button below —
  // Keyboard.hide() is a native call that dismisses just the visual IME,
  // it doesn't blur the field or touch any input attribute, so it has no
  // effect on real scanner input (unlike inputMode/readOnly, which do).
  const [manualKeyboard, setManualKeyboard] = useState(false);

  useEffect(() => {
    const refocus = () => {
      if (!scanning && inputRef.current && document.activeElement !== inputRef.current) {
        try { inputRef.current.focus({ preventScroll: true }); } catch { /* ignore */ }
      }
      if (!manualKeyboard && Capacitor.isNativePlatform()) {
        Keyboard.hide().catch(() => {});
      }
    };
    refocus();
    const t = setInterval(refocus, 400);
    return () => clearInterval(t);
  }, [scanning, parcels.length, manualKeyboard]);

  const openManualKeyboard = () => {
    setManualKeyboard(true);
    inputRef.current?.focus();
    if (Capacitor.isNativePlatform()) Keyboard.show().catch(() => {});
  };

  // Fallback for scanners/DataWedge configs that commit the scanned text
  // without sending an Enter/newline terminator at all: submit once the
  // buffer has stopped changing for a moment. 400ms is well past a
  // scanner's burst-typed characters, but doesn't get in the way of the
  // explicit-Enter path below, which still fires immediately.
  useEffect(() => {
    if (!buffer) return undefined;
    const t = setTimeout(() => {
      submitScan(buffer);
      setBuffer('');
    }, 400);
    return () => clearTimeout(t);
  }, [buffer, submitScan]);

  const scanWithCamera = async () => {
    const code = await scan();
    if (code) submitScan(code);
  };

  const onKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitScan(buffer);
      setBuffer('');
    }
  };

  const boxes = parcels.reduce((a, p) => a + p.boxes, 0);
  const codeSize = last && last.code.length > 18 ? 'text-[17px]' : 'text-[21px]';

  return (
    <div className="flex flex-col gap-3 pb-5">
      {/* Pinned to the top of the screen so the just-scanned code stays in
          view no matter how long the parcel list below grows — the operator
          shouldn't have to scroll up to confirm what was just scanned. */}
      <div className="sticky top-0 z-10 flex flex-col gap-3 bg-page px-3.5 pb-1 pt-3">
      <div className="flex items-center gap-2">
        <div className="rounded-full px-2 py-[3px] text-[10px] font-extrabold uppercase tracking-[.1em] text-white" style={{ background: isOut ? '#FF7A00' : '#1F6FEB' }}>
          {isOut ? 'Outbound' : 'Inbound'}
        </div>
        <div className="font-mono text-[11px] text-secondary">{carrier} · {nextDoc}</div>
        <div className="ml-auto text-[11px] text-light">{sessionStartedAt ? elapsedLabel(sessionStartedAt) : ''}</div>
      </div>

      <div
        className={
          'rounded-2xl border p-[16px_14px] shadow-card transition-colors ' +
          (flash === 'bad' ? 'border-[rgba(220,38,38,.5)]' : 'border-[rgba(148,163,184,.25)]') +
          (flash === 'ok' ? ' animate-flashOk' : flash === 'bad' ? ' animate-flashBad' : '')
        }
        style={{ background: '#fff' }}
      >
        {last ? (
          <>
            <div className="mb-2.5 flex items-center gap-2">
              <Check size={18} strokeWidth={2.4} className={last.damage ? 'text-danger' : 'text-success'} />
              <div className={'text-[11px] font-extrabold uppercase tracking-[.08em] ' + (last.damage ? 'text-danger' : 'text-success')}>
                {last.damage ? 'Recorded with damage' : 'Scan accepted'}
              </div>
              <div className="ml-auto font-mono text-[11px] text-light">{last.time}</div>
            </div>
            <div className={'break-all font-mono font-bold leading-tight tracking-[-.01em] text-ink ' + codeSize}>{last.code}</div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <div className="text-[13px] font-bold text-ink">{last.carrier}</div>
              {last.boxes > 1 && (
                <div className="rounded-full bg-[rgba(15,23,42,.06)] px-2 py-[3px] text-[10px] font-extrabold uppercase tracking-[.06em] text-ink">
                  {last.boxes} boxes
                </div>
              )}
              {last.expected !== null && last.expected !== undefined && (
                <div
                  className="rounded-full px-2 py-[3px] text-[10px] font-extrabold uppercase tracking-[.06em]"
                  style={{ background: last.expected ? 'rgba(22,163,74,.12)' : 'rgba(255,122,0,.14)', color: last.expected ? '#15803D' : '#C2410C' }}
                >
                  {last.expected ? 'Expected' : 'Not on manifest'}
                </div>
              )}
            </div>
            {last.damage && (
              <div className="mt-3 flex items-start gap-2 rounded-[11px] border border-[rgba(220,38,38,.25)] bg-danger-tint2 p-2.5">
                <TriangleAlert size={16} strokeWidth={2} className="mt-px flex-none text-danger" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-danger-dark">{last.damage}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-danger">{last.photo}</div>
                </div>
                {last.photoDataUrl && (
                  <button onClick={() => openPhoto(last.photoDataUrl)} className="flex-none">
                    <img src={last.photoDataUrl} alt="Damage attachment" className="h-12 w-12 rounded-md border border-[rgba(220,38,38,.35)] object-cover" />
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2.5 py-3.5">
            <ScanLine size={40} strokeWidth={1.5} className="text-light" />
            <div className="text-[15px] font-bold text-ink">Pull the trigger to scan</div>
            <div className="max-w-[220px] text-center text-xs text-secondary">The tracking ID lands in the field below and is submitted automatically.</div>
          </div>
        )}
      </div>
      </div>

      <div className="flex flex-col gap-3 px-3.5">
      <div className="flex gap-2.5">
        <button onClick={openDamage} className="flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-[rgba(220,38,38,.3)] bg-white text-[13px] font-bold text-danger">
          <TriangleAlert size={16} strokeWidth={2} /> Damage
        </button>
        <button onClick={removeLast} className="flex min-h-[48px] w-[52px] flex-none items-center justify-center rounded-xl border border-[rgba(148,163,184,.35)] bg-white text-secondary">
          <Trash2 size={17} strokeWidth={2} />
        </button>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-[rgba(148,163,184,.25)] bg-white">
        <div className="flex items-center gap-2 border-b border-[rgba(148,163,184,.25)] bg-page px-3 py-2.5">
          <div className="text-[10px] font-bold uppercase tracking-[.08em] text-secondary">Session</div>
          <div className="ml-auto text-[11px] font-bold text-ink">{parcels.length} parcels / {boxes} boxes</div>
        </div>
        {parcels.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-light">No parcels in this session yet.</div>
        ) : (
          parcels.slice().reverse().map((r, i) => (
            <div key={r.code} className="flex items-center gap-2.5 border-b border-[rgba(148,163,184,.15)] px-3 py-2.5 last:border-b-0">
              <div className="w-[18px] flex-none font-mono text-[10px] text-light">{parcels.length - i}</div>
              <div className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-semibold">{r.code}</div>
              {r.damage && <div className="flex-none text-[11px] font-bold text-danger">DMG</div>}
              <div className="flex-none text-[11px] font-bold text-ink">{r.boxes}×</div>
              <button
                onClick={() => removeParcel(r.code)}
                aria-label={`Remove ${r.code}`}
                className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-light"
              >
                <X size={15} strokeWidth={2.2} />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="rounded-[14px] border border-[rgba(148,163,184,.25)] bg-white p-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[.08em] text-secondary">Tracking ID · scanner ready</div>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={buffer}
            onChange={(e) => setBuffer(e.target.value)}
            onKeyDown={onKey}
            onBlur={() => setManualKeyboard(false)}
            placeholder="waiting for scan…"
            className="min-h-[54px] min-w-0 flex-1 rounded-xl border-2 border-primary bg-white px-4 font-mono text-[15px] tracking-[.02em] text-ink shadow-focusring"
          />
          {/* A real, thumb-sized button rather than a small text link — this
              is the only way to scan at all on a phone with no hardware
              engine, and even on a Zebra it's a common fallback (a badly
              printed label, a scuffed barcode), so it needs to be easy to
              hit one-handed, not a tiny target buried in a corner. */}
          {isCameraScanSupported() && (
            <button
              onClick={scanWithCamera}
              disabled={scanning}
              aria-label="Scan with camera"
              className="flex min-h-[54px] w-[54px] flex-none items-center justify-center rounded-xl bg-primary text-white shadow-focusring disabled:opacity-60"
            >
              <Camera size={22} strokeWidth={2} />
            </button>
          )}
        </div>
        <button onClick={openManualKeyboard} className="mt-2 flex items-center gap-1 text-[10.5px] font-bold text-secondary">
          <KeyboardIcon size={12} strokeWidth={2} /> Type manually instead
        </button>
        {scanError && <div className="mt-2 text-[11px] text-danger">{scanError}</div>}
      </div>

      <button onClick={toSign} className="flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-xl bg-ink text-[15px] font-extrabold text-white">
        <PenLine size={18} strokeWidth={2} /> Close session &amp; sign
      </button>
      </div>
    </div>
  );
}
