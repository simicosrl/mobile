import { useEffect, useState } from 'react';
import { useReceiving, recvErrorText } from '../state/ReceivingContext';
import { useScanInput } from '../hooks/useScanInput';
import { useBarcodeScanner, isCameraScanSupported } from '../hooks/useBarcodeScanner';
import CameraScanOverlay from '../components/CameraScanOverlay';
import { ReceptionRow } from '../components/ReceptionBits';
import { ScanLine, Camera, Search, RefreshCw, X, TriangleAlert, Keyboard as KeyboardIcon } from '../components/icons';
import { feedback } from '../lib/audio';

// Receiving, step one: find the client's reception. Scanning a parcel's
// tracking opens its reception directly; the open receptions are listed
// below for anything without a scannable label.
export default function ReceivingStart() {
  const {
    country, open, refreshOpen, lookup, looking, lookupTracking, searchReceptions, clearLookup, openReception,
  } = useReceiving();
  const [search, setSearch] = useState('');
  const { scan, scanning, error: cameraError, cancel: cancelCamera } = useBarcodeScanner();
  const scanner = useScanInput((code) => lookupTracking(code), { paused: scanning || looking });

  useEffect(() => { refreshOpen(); }, [refreshOpen]);

  // Sound for what a scan found: one reception opens by itself; nothing is
  // the case the operator needs to notice.
  useEffect(() => {
    if (lookup?.kind !== 'tracking' || lookup.error) return;
    feedback(lookup.rows.length === 0);
  }, [lookup]);

  const scanWithCamera = async () => {
    const code = await scan();
    if (code) lookupTracking(code);
  };

  const submitSearch = (e) => {
    e.preventDefault();
    searchReceptions(search);
  };

  const results = lookup && !(lookup.kind === 'tracking' && lookup.exact && lookup.rows.length === 1) ? lookup : null;

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-[22px] pt-3.5">
      {scanning && <CameraScanOverlay onCancel={cancelCamera} />}

      <div className="rounded-2xl border border-[rgba(31,111,235,.25)] bg-white p-3.5 shadow-card">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary text-white">
            <ScanLine size={22} strokeWidth={1.9} />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-extrabold tracking-[-.015em]">Scan the parcel's tracking</div>
            <div className="text-[11.5px] leading-snug text-secondary">
              {looking ? 'Looking it up on the Prep-Center…' : `Opens the client's reception · ${country || ''} warehouse`}
            </div>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <input
            {...scanner.inputProps}
            placeholder="Tracking number…"
            className={
              scanner.showInput
                ? 'min-h-[50px] min-w-0 flex-1 rounded-xl border-2 border-primary bg-white px-3.5 font-mono text-[15px] text-ink shadow-focusring'
                : 'absolute h-px w-px opacity-0'
            }
          />
          {isCameraScanSupported() && (
            <button
              onClick={scanWithCamera}
              disabled={scanning || looking}
              className={
                'flex min-h-[50px] items-center justify-center gap-2 rounded-xl bg-primary text-white disabled:opacity-60 ' +
                (scanner.showInput ? 'w-[50px] flex-none' : 'flex-1 text-[14px] font-bold')
              }
              aria-label="Scan with camera"
            >
              <Camera size={19} strokeWidth={2} /> {!scanner.showInput && (scanning ? 'Opening…' : 'Scan with camera')}
            </button>
          )}
        </div>
        {isCameraScanSupported() && !scanner.showInput && (
          <button onClick={scanner.openManual} className="mt-2 flex items-center gap-1 text-[10.5px] font-bold text-secondary">
            <KeyboardIcon size={12} strokeWidth={2} /> Type the tracking instead
          </button>
        )}
        {cameraError && <div className="mt-2 text-[11.5px] text-danger">{cameraError}</div>}
      </div>

      {results && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-[.1em] text-light">
              {results.kind === 'tracking' ? 'Tracking' : 'Search'} · <span className="font-mono normal-case tracking-normal">{results.query}</span>
            </div>
            <button onClick={clearLookup} aria-label="Clear" className="flex h-7 w-7 items-center justify-center rounded-full text-light">
              <X size={15} strokeWidth={2.2} />
            </button>
          </div>
          {results.error ? (
            <div className="rounded-xl border border-danger/30 bg-danger-tint2 p-3 text-[12.5px] text-danger-dark">{recvErrorText(results.error)}</div>
          ) : results.rows.length === 0 ? (
            <div className="flex gap-2.5 rounded-xl border border-[rgba(255,122,0,.35)] bg-[rgba(255,122,0,.07)] p-3">
              <TriangleAlert size={18} strokeWidth={2} className="mt-0.5 flex-none text-accent-dark" />
              <div className="text-[12.5px] leading-snug text-ink">
                {results.kind === 'tracking'
                  ? `No reception in the ${country} warehouse has this tracking. Search by client below, or check the open receptions.`
                  : 'Nothing found.'}
              </div>
            </div>
          ) : (
            <>
              {results.kind === 'tracking' && (
                <div className="text-[12px] text-secondary">
                  {results.exact
                    ? `${results.rows.length} receptions have this tracking — choose one.`
                    : 'No exact match — these receptions have a similar tracking:'}
                </div>
              )}
              {results.rows.map((row) => (
                <ReceptionRow key={row.id} row={row} onOpen={openReception} highlight={results.kind === 'tracking' ? results.query : null} />
              ))}
            </>
          )}
        </div>
      )}

      <form onSubmit={submitSearch} className="flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Client, email, tracking, SKU…"
          className="min-h-[46px] min-w-0 flex-1 rounded-xl border border-inputborder bg-white px-3.5 text-[14px] text-ink"
        />
        <button
          type="submit"
          disabled={!search.trim() || looking}
          aria-label="Search"
          className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-xl border border-inputborder bg-white text-primary disabled:text-light"
        >
          <Search size={18} strokeWidth={2.2} />
        </button>
      </form>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 text-[10px] font-bold uppercase tracking-[.1em] text-light">
            Open receptions{open.loadedAt ? ` · ${open.rows.length}` : ''}
          </div>
          <button onClick={refreshOpen} disabled={open.loading} aria-label="Refresh" className="flex h-7 w-7 items-center justify-center rounded-full text-secondary disabled:opacity-50">
            <RefreshCw size={14} strokeWidth={2.2} className={open.loading ? 'animate-spin' : ''} />
          </button>
        </div>
        {open.error && (
          <div className="rounded-xl border border-danger/30 bg-danger-tint2 p-3 text-[12.5px] text-danger-dark">{recvErrorText(open.error)}</div>
        )}
        {!open.error && open.loadedAt && open.rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-[rgba(148,163,184,.4)] p-4 text-center text-[12.5px] text-secondary">
            Nothing waiting to be received.
          </div>
        )}
        {!open.loadedAt && open.loading && <div className="p-4 text-center text-[12.5px] text-secondary">Loading…</div>}
        {open.rows.map((row) => <ReceptionRow key={row.id} row={row} onOpen={openReception} />)}
      </div>
    </div>
  );
}
