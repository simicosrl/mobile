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
    openNoCodeSheet, rejectedScan, damageSheet, noCodeSheet,
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
    // Damage and "no code" are sheets, not separate screens — they render
    // as an overlay on top of Scan, which stays mounted underneath with
    // this same interval still running. Left unguarded, it was yanking
    // focus back to this hidden field and force-closing the IME every
    // 400ms while the operator was mid-keystroke in the sheet's own note
    // field — effectively making it impossible to type anything there.
    if (damageSheet.open || noCodeSheet.open) return undefined;
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
  }, [scanning, parcels.length, manualKeyboard, damageSheet.open, noCodeSheet.open]);

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
  //
  // Skipped entirely while the operator is typing by hand (manualKeyboard):
  // a human pausing mid-code — to read the next digits off a label, or just
  // thinking — easily leaves the field untouched for 400ms, which used to
  // submit whatever partial code was there so far instead of waiting for
  // the code to actually be finished. Manual entry is only ever submitted
  // by an explicit Enter, below.
  useEffect(() => {
    if (!buffer || manualKeyboard) return undefined;
    const t = setTimeout(() => {
      submitScan(buffer);
      setBuffer('');
    }, 400);
    return () => clearTimeout(t);
  }, [buffer, submitScan, manualKeyboard]);

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
  // The tracking field is only ever shown once the operator explicitly asks
  // to type (manualKeyboard) — otherwise it's a 1px invisible focus target
  // for the hardware scanner-wedge, no visible "waiting for scan…" box.
  // Exception: with no camera fallback on this platform, hiding it would
  // leave nothing else visible to scan with at all.
  const showTrackingInput = manualKeyboard || !isCameraScanSupported();

  return (
    <div className="flex flex-col gap-3 pb-5">
      <div className="flex flex-col gap-3 bg-page px-3.5 pb-1 pt-3">
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
              {last.noCode ? (
                <TriangleAlert size={18} strokeWidth={2.4} className="text-[#C2410C]" />
              ) : (
                <Check size={18} strokeWidth={2.4} className={last.damage ? 'text-danger' : 'text-success'} />
              )}
              <div
                className={
                  'text-[11px] font-extrabold uppercase tracking-[.08em] ' +
                  (last.noCode ? 'text-[#C2410C]' : last.damage ? 'text-danger' : 'text-success')
                }
              >
                {last.noCode ? 'No valid code — logged with photo' : last.damage ? 'Recorded with damage' : 'Scan accepted'}
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
            {last.noCode && (
              <div className="mt-3 flex items-start gap-2 rounded-[11px] border border-[rgba(255,122,0,.3)] bg-[rgba(255,122,0,.08)] p-2.5">
                <TriangleAlert size={16} strokeWidth={2} className="mt-px flex-none text-[#C2410C]" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-[#C2410C]">Flagged for the office to reconcile</div>
                  {last.noCodeNote && <div className="mt-0.5 text-[10.5px] text-[#C2410C]">{last.noCodeNote}</div>}
                </div>
                {last.noCodePhotoDataUrl && (
                  <button onClick={() => openPhoto(last.noCodePhotoDataUrl)} className="flex-none">
                    <img src={last.noCodePhotoDataUrl} alt="Parcel photo" className="h-12 w-12 rounded-md border border-[rgba(255,122,0,.35)] object-cover" />
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2.5 py-1">
            <ScanLine size={22} strokeWidth={1.6} className="flex-none text-light" />
            <div className="text-[13px] font-bold text-ink">Pull the trigger to scan</div>
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
              {r.noCode && <div className="flex-none text-[11px] font-bold text-[#C2410C]">NO CODE</div>}
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

      <div className="relative rounded-[14px] border border-[rgba(148,163,184,.25)] bg-white p-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[.08em] text-secondary">Scanner ready</div>
        <div className="flex gap-2">
          {/* Stays in the DOM and focused either way, so a hardware
              scanner-wedge always has somewhere to type into — but there's
              no reason to show an empty "waiting for scan…" box with a
              blinking cursor for that, when the actual instant it matters
              (a real scan lands) is already shown above, and there are
              three explicit ways in already visible below (camera, manual
              typing, photo). Only actually shown once the operator taps
              "Type manually instead", so they can see what they're typing. */}
          <input
            ref={inputRef}
            value={buffer}
            onChange={(e) => setBuffer(e.target.value)}
            onKeyDown={onKey}
            onBlur={() => setManualKeyboard(false)}
            placeholder="Type the code…"
            inputMode={showTrackingInput ? 'text' : 'none'}
            aria-hidden={!showTrackingInput}
            className={
              showTrackingInput
                ? 'min-h-[54px] min-w-0 flex-1 rounded-xl border-2 border-primary bg-white px-4 font-mono text-[15px] tracking-[.02em] text-ink shadow-focusring'
                : 'absolute h-px w-px opacity-0'
            }
          />
          {/* A real, thumb-sized button rather than a small text link — this
              is the only way to scan at all on a phone with no hardware
              engine, and even on a Zebra it's a common fallback (a badly
              printed label, a scuffed barcode), so it needs to be easy to
              hit one-handed, not a tiny target buried in a corner. Fills
              the row on its own while the tracking field is hidden. */}
          {isCameraScanSupported() && (
            <button
              onClick={scanWithCamera}
              disabled={scanning}
              aria-label="Scan with camera"
              className={
                'flex min-h-[54px] items-center justify-center gap-2 rounded-xl bg-primary text-white shadow-focusring disabled:opacity-60 ' +
                (showTrackingInput ? 'w-[54px] flex-none' : 'flex-1 text-[14px] font-bold')
              }
            >
              <Camera size={20} strokeWidth={2} /> {!showTrackingInput && (scanning ? 'Opening…' : 'Scan with camera')}
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <button onClick={openManualKeyboard} className="flex items-center gap-1 text-[10.5px] font-bold text-secondary">
            <KeyboardIcon size={12} strokeWidth={2} /> Type manually instead
          </button>
          <button onClick={() => openNoCodeSheet()} className="flex items-center gap-1 text-[10.5px] font-bold text-[#C2410C]">
            <Camera size={12} strokeWidth={2} /> Can't scan it? Log with photo
          </button>
        </div>
        {/* Follow-up action right where the rejection happened, rather than
            leaving the operator stuck with a code that was scanned but
            can't go anywhere — the photo requirement in the sheet itself
            keeps this from being a one-tap way around the carrier rule. */}
        {rejectedScan && (
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-[rgba(255,122,0,.35)] bg-[rgba(255,122,0,.08)] p-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[11px] font-bold text-[#C2410C]">{rejectedScan.code}</div>
              <div className="text-[10.5px] text-[#C2410C]">Rejected — {rejectedScan.reason}</div>
            </div>
            <button
              onClick={() => openNoCodeSheet(`Scanned: ${rejectedScan.code} — ${rejectedScan.reason}`)}
              className="flex-none rounded-lg bg-[#FF7A00] px-2.5 py-2 text-[11px] font-bold text-white"
            >
              Log anyway
            </button>
          </div>
        )}
        {scanError && <div className="mt-2 text-[11px] text-danger">{scanError}</div>}
      </div>

      <button onClick={toSign} className="flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-xl bg-ink text-[15px] font-extrabold text-white">
        <PenLine size={18} strokeWidth={2} /> Close session &amp; sign
      </button>
      </div>
    </div>
  );
}
