import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/AppContext';
import { useReceiving, recvErrorText } from '../state/ReceivingContext';
import { useScanInput } from '../hooks/useScanInput';
import { useBarcodeScanner, isCameraScanSupported } from '../hooks/useBarcodeScanner';
import CameraScanOverlay from '../components/CameraScanOverlay';
import { StatusChip, shortDate, dayMonth } from '../components/ReceptionBits';
import { matchLines, normalizeTracking } from '../lib/prepReceiving';
import { feedback } from '../lib/audio';
import { Camera, RefreshCw, TriangleAlert, ScanLine, Keyboard as KeyboardIcon, X, Plus } from '../components/icons';

// Receiving, step two: the client's reception — every product with its
// picture, codes and the client's notes — and recording what arrived:
// scanning a product's barcode adds one unit to its line, tapping a product
// sets the count by hand. Each change is saved to the Prep-Center in the
// background (ReceivingContext's queue), exactly as the website saves it.

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'todo', label: 'To receive' },
  { id: 'done', label: 'Done' },
  { id: 'over', label: 'Over' },
];

// `l.shown` is the count on screen: the Prep-Center's plus anything not sent yet.
function lineState(l) {
  const got = l.shown ?? l.received;
  if (l.expected > 0 && got > l.expected) return 'over';
  if (l.expected > 0 && got >= l.expected) return 'done';
  if (got > 0) return 'partial';
  return 'todo';
}

function SyncLine({ entry, result, onRetry, onDiscard }) {
  if (entry?.status === 'sending' || (entry && entry.status === 'pending')) {
    return <div className="mt-2 text-[11px] font-bold text-primary">Saving to the Prep-Center…</div>;
  }
  if (entry?.status === 'waiting') {
    return (
      <div className="mt-2 text-[11px] font-bold text-accent-dark">
        {entry.error === 'offline' ? 'No connection — saved on this phone, will send automatically.' : recvErrorText(entry.error)}
      </div>
    );
  }
  if (entry?.status === 'error') {
    return (
      <div className="mt-2 rounded-lg bg-danger-tint2 px-2.5 py-2 text-[11.5px] text-danger-dark">
        <div className="font-bold">Not saved: {entry.message || recvErrorText(entry.error)}</div>
        <div className="mt-1.5 flex gap-3">
          <button onClick={onRetry} className="font-extrabold underline underline-offset-2">Retry</button>
          <button onClick={onDiscard} className="font-extrabold underline underline-offset-2">Discard my change</button>
        </div>
      </div>
    );
  }
  if (result?.belowAssigned != null) {
    return (
      <div className="mt-2 text-[11px] font-bold text-danger">
        {result.belowAssigned} units are already on a shelf — move or unassign them on the website before lowering the count.
      </div>
    );
  }
  if (result?.placementError) {
    return <div className="mt-2 text-[11px] font-bold text-accent-dark">Received, but not placed on the client's shelf: {result.placementError}</div>;
  }
  if (result?.placedOn) {
    return <div className="mt-2 text-[11px] font-bold text-success-dark">Saved · placed on shelf {result.placedOn}</div>;
  }
  return null;
}

const STATE_STYLE = {
  todo: { bar: 'bg-light', qty: 'text-secondary' },
  partial: { bar: 'bg-primary', qty: 'text-primary' },
  done: { bar: 'bg-success', qty: 'text-success-dark' },
  over: { bar: 'bg-danger', qty: 'text-danger' },
};

function Note({ note }) {
  const fromClient = note.from === 'client';
  return (
    <div className={`rounded-lg px-2.5 py-2 text-[12px] leading-snug ${fromClient ? 'bg-[#FEF9C3] text-[#713F12]' : 'bg-segtrack text-ink'}`}>
      <div className="mb-0.5 text-[9.5px] font-extrabold uppercase tracking-[.08em] opacity-70">
        {fromClient ? 'Client' : note.from === 'admin' ? 'Office' : 'System'}
        {note.kind === 'issue' ? ' · issue' : note.kind === 'transparency_codes' ? ' · transparency codes' : ''}
        {note.at ? ` · ${shortDate(note.at)}` : ''}
      </div>
      <div className="whitespace-pre-wrap break-words">{note.body}</div>
    </div>
  );
}

function Code({ label, value }) {
  if (!value) return null;
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-segtrack px-1.5 py-[2px] font-mono text-[10.5px] text-ink">
      <span className="font-sans text-[9px] font-extrabold uppercase tracking-[.06em] text-secondary">{label}</span>
      <span className="truncate">{value}</span>
    </span>
  );
}

function ProductCard({ line, highlighted, cardRef, onPhoto, onTap, entry, result, onRetry, onDiscard }) {
  // A dead image link (moved, expired, offline) shows the placeholder rather
  // than the browser's broken-image icon.
  const [imageFailed, setImageFailed] = useState(false);
  const image = imageFailed ? null : line.image;
  const state = lineState(line);
  const style = STATE_STYLE[state];
  const pct = line.expected > 0 ? Math.min(100, Math.round((line.shown / line.expected) * 100)) : 0;
  return (
    <div
      ref={cardRef}
      onClick={onTap}
      role={onTap ? 'button' : undefined}
      className={
        'rounded-xl border bg-white p-3 shadow-card transition-colors ' +
        (highlighted ? 'border-primary ring-2 ring-[rgba(31,111,235,.25)] animate-flashOk' : 'border-[rgba(148,163,184,.25)]')
      }
    >
      <div className="flex gap-3">
        <button
          onClick={(e) => { e.stopPropagation(); if (image) onPhoto(image); }}
          className="flex h-[68px] w-[68px] flex-none items-center justify-center overflow-hidden rounded-lg border border-[rgba(148,163,184,.25)] bg-page"
          aria-label="Product photo"
        >
          {image
            ? <img src={image} alt="" loading="lazy" onError={() => setImageFailed(true)} className="h-full w-full object-contain" />
            : <span className="text-[9px] font-bold uppercase text-light">No photo</span>}
        </button>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[13px] font-bold leading-snug text-ink">{line.name}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Code label="EAN" value={line.ean} />
            <Code label="ASIN" value={line.asin} />
            <Code label="FNSKU" value={line.fnsku} />
            <Code label="SKU" value={line.sku} />
          </div>
        </div>
        <div className="flex-none text-right">
          <div className={`text-[19px] font-extrabold leading-none tracking-[-.02em] ${style.qty}`}>
            {line.shown}<span className="text-[13px] font-bold text-light"> / {line.expected}</span>
          </div>
          <div className="mt-1 text-[9.5px] font-bold uppercase tracking-[.06em] text-light">units</div>
          {line.sendToFba && <div className="mt-1 text-[9.5px] font-extrabold uppercase text-accent-dark">FBA {line.fbaQty || ''}</div>}
        </div>
      </div>
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-segtrack">
        <div className={`h-full ${style.bar}`} style={{ width: `${state === 'over' ? 100 : pct}%` }} />
      </div>
      <SyncLine entry={entry} result={result} onRetry={onRetry} onDiscard={onDiscard} />
      {line.notes.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {line.notes.map((n) => <Note key={n.id} note={n} />)}
        </div>
      )}
    </div>
  );
}

function Sheet({ children, onClose }) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end bg-[rgba(15,23,42,.45)]" onClick={onClose}>
      <div className="rounded-t-[20px] bg-white p-4 pb-6 animate-fadeUp" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// Count typed by hand: the number of units of this product that have arrived
// in total, not the number to add.
function QtySheet({ line, onSave, onClose }) {
  const [value, setValue] = useState(String(line.shown));
  const n = Math.max(0, Math.floor(Number(value) || 0));
  const over = line.expected > 0 && n > line.expected ? n - line.expected : 0;
  return (
    <Sheet onClose={onClose}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[14px] font-extrabold leading-snug">{line.name}</div>
          <div className="mt-0.5 text-[11.5px] text-secondary">Expected {line.expected} · total received so far</div>
        </div>
        <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-light"><X size={17} /></button>
      </div>
      <div className="mt-4 flex items-center gap-2.5">
        <button onClick={() => setValue(String(Math.max(0, n - 1)))} className="flex h-14 w-14 flex-none items-center justify-center rounded-xl border border-inputborder text-[26px] font-bold text-ink">−</button>
        <input
          autoFocus
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ''))}
          onFocus={(e) => e.target.select()}
          className="min-h-[56px] min-w-0 flex-1 rounded-xl border-2 border-primary text-center text-[28px] font-extrabold text-ink"
        />
        <button onClick={() => setValue(String(n + 1))} className="flex h-14 w-14 flex-none items-center justify-center rounded-xl border border-inputborder text-ink"><Plus size={24} /></button>
      </div>
      {over > 0 && <div className="mt-2 text-center text-[12px] font-bold text-danger">{over} more than expected</div>}
      <div className="mt-4 flex gap-2.5">
        {line.expected > 0 && (
          <button onClick={() => setValue(String(line.expected))} className="flex min-h-[50px] flex-1 items-center justify-center rounded-xl border border-inputborder text-[14px] font-bold text-ink">
            All ({line.expected})
          </button>
        )}
        <button onClick={() => onSave(n)} className="flex min-h-[50px] flex-[1.4] items-center justify-center rounded-xl bg-primary text-[15px] font-extrabold text-white">
          Save {n}
        </button>
      </div>
    </Sheet>
  );
}

export default function ReceivingOrder() {
  const { showToast, openPhoto } = useApp();
  const {
    current, reloadCurrent, queue, results, shownReceived, addUnits, setUnits, undoLast, undoTop, retryLine, discardLine,
  } = useReceiving();
  const raw = current.reception;
  // Lines with the count to show (Prep-Center's + not yet sent).
  const r = useMemo(() => (raw ? { ...raw, lines: raw.lines.map((l) => ({ ...l, shown: shownReceived(l) })) } : null), [raw, shownReceived]);
  // Open sheet: { kind: 'qty', line } | { kind: 'choose', lines } | { kind: 'over', line }
  const [sheet, setSheet] = useState(null);
  // Lines the operator already agreed to receive beyond the expected count.
  const [overOk, setOverOk] = useState(() => new Set());
  const [filter, setFilter] = useState('all');
  const [highlight, setHighlight] = useState([]);
  const cardRefs = useRef(new Map());
  const { scan, scanning, error: cameraError, cancel: cancelCamera } = useBarcodeScanner();

  const isRemoval = r?.importSource === 'amazon_removal_order';
  const canReceive = !!r && !isRemoval && !r.hasLegacyLinesOnly && r.status !== 'cancelled';

  // One unit of this line arrived. Past the expected count the operator
  // confirms once per line; after that, scans just keep counting.
  const receiveOne = (line) => {
    setFilter('all');
    setHighlight([line.id]);
    if (line.expected > 0 && line.shown + 1 > line.expected && !overOk.has(line.id)) {
      feedback(true);
      setSheet({ kind: 'over', line });
      return;
    }
    feedback(false);
    addUnits(line, 1);
  };

  const onProductCode = (code) => {
    if (!r) return;
    const hits = matchLines(r.lines, code);
    if (hits.length === 1 && canReceive) { receiveOne(hits[0]); return; }
    if (hits.length > 1 && canReceive) {
      feedback(false);
      setHighlight(hits.map((l) => l.id));
      setSheet({ kind: 'choose', lines: hits });
      return;
    }
    if (hits.length) {
      feedback(false);
      setFilter('all');
      setHighlight(hits.map((l) => l.id));
      return;
    }
    feedback(true);
    setHighlight([]);
    showToast(
      r.trackings.includes(normalizeTracking(code))
        ? 'That is a parcel of this reception — scan a product barcode'
        : `${code} is not in this reception — it can't be received into stock`,
    );
  };
  const scanner = useScanInput(onProductCode, { paused: scanning || !r || !!sheet });

  const doUndo = () => {
    const last = undoLast();
    if (last) showToast(`Undone: ${last.n > 0 ? '+' : ''}${last.n} ${last.name}`);
  };

  // Bring the scanned product into view.
  useEffect(() => {
    if (!highlight.length) return;
    const el = cardRefs.current.get(highlight[0]);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight]);

  const totals = useMemo(() => {
    const lines = r?.lines || [];
    return {
      expected: lines.reduce((a, l) => a + l.expected, 0),
      received: lines.reduce((a, l) => a + l.shown, 0),
      done: lines.filter((l) => ['done', 'over'].includes(lineState(l))).length,
      count: lines.length,
      byFilter: {
        all: lines.length,
        todo: lines.filter((l) => ['todo', 'partial'].includes(lineState(l))).length,
        done: lines.filter((l) => lineState(l) === 'done').length,
        over: lines.filter((l) => lineState(l) === 'over').length,
      },
    };
  }, [r]);

  const shown = useMemo(() => {
    const lines = r?.lines || [];
    if (filter === 'todo') return lines.filter((l) => ['todo', 'partial'].includes(lineState(l)));
    if (filter === 'done') return lines.filter((l) => lineState(l) === 'done');
    if (filter === 'over') return lines.filter((l) => lineState(l) === 'over');
    return lines;
  }, [r, filter]);

  if (!r) {
    return (
      <div className="flex flex-col gap-3 px-3.5 pt-6">
        {current.error ? (
          <>
            <div className="rounded-xl border border-danger/30 bg-danger-tint2 p-3 text-[12.5px] text-danger-dark">{recvErrorText(current.error)}</div>
            <button onClick={reloadCurrent} className="self-center text-[12.5px] font-bold text-primary underline underline-offset-2">Try again</button>
          </>
        ) : (
          <div className="p-6 text-center text-[13px] text-secondary">Loading reception…</div>
        )}
      </div>
    );
  }

  const pct = totals.expected > 0 ? Math.min(100, Math.round((totals.received / totals.expected) * 100)) : 0;

  return (
    <div className="flex flex-col gap-3 px-3.5 pb-[22px] pt-3.5">
      {scanning && <CameraScanOverlay onCancel={cancelCamera} />}

      <div className="rounded-2xl border border-[rgba(148,163,184,.25)] bg-white p-3.5 shadow-card">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-extrabold tracking-[-.015em]">{r.company || r.clientName || r.clientEmail || 'Client'}</div>
            {r.company && (r.clientName || r.clientEmail) && (
              <div className="truncate text-[11.5px] text-secondary">{r.clientName || r.clientEmail}</div>
            )}
          </div>
          <StatusChip status={r.status} />
          <button onClick={reloadCurrent} disabled={current.loading} aria-label="Refresh" className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-secondary disabled:opacity-50">
            <RefreshCw size={14} strokeWidth={2.2} className={current.loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {r.trackings.map((t) => (
            <span key={t} className="rounded-md bg-segtrack px-1.5 py-[2px] font-mono text-[10.5px] text-ink">{t}</span>
          ))}
        </div>
        <div className="mt-1.5 text-[11px] text-secondary">
          {[r.carrier, r.createdAt && `Announced ${dayMonth(r.createdAt)}`, `#${String(r.id).slice(0, 8)}`].filter(Boolean).join(' · ')}
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <div className="text-[12px] font-bold text-ink">
            {totals.received} / {totals.expected} units
          </div>
          <div className="text-[11px] text-secondary">{totals.done} of {totals.count} products complete</div>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-segtrack">
          <div className="h-full bg-success" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {isRemoval && (
        <div className="flex gap-2.5 rounded-xl border border-[rgba(255,122,0,.35)] bg-[rgba(255,122,0,.07)] p-3 text-[12.5px] leading-snug text-ink">
          <TriangleAlert size={18} strokeWidth={2} className="mt-0.5 flex-none text-accent-dark" />
          Amazon removal order — these units are inspected on the Prep-Center website, not in the app.
        </div>
      )}
      {r.hasLegacyLinesOnly && (
        <div className="rounded-xl border border-[rgba(148,163,184,.35)] bg-white p-3 text-[12.5px] text-secondary">
          This reception uses the older product format. Open it on the Prep-Center website.
        </div>
      )}

      {(r.intakeNote || r.notes.length > 0) && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold uppercase tracking-[.1em] text-light">Notes</div>
          {r.intakeNote && <Note note={{ id: 'intake', from: 'client', kind: 'message', body: r.intakeNote }} />}
          {r.notes.map((n) => <Note key={n.id} note={n} />)}
        </div>
      )}

      {!isRemoval && r.lines.length > 0 && (
        <div className="rounded-[14px] border border-[rgba(148,163,184,.25)] bg-white p-3">
          <div className="flex items-center gap-2">
            <ScanLine size={16} strokeWidth={2} className="flex-none text-primary" />
            <div className="min-w-0 flex-1 text-[11.5px] leading-snug text-secondary">
              {canReceive
                ? 'Scan a product barcode to receive one unit. Tap a product to type the count.'
                : 'Scan a product barcode to find it in this reception.'}
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <input
              {...scanner.inputProps}
              placeholder="EAN, FNSKU, ASIN or SKU…"
              className={
                scanner.showInput
                  ? 'min-h-[46px] min-w-0 flex-1 rounded-xl border-2 border-primary bg-white px-3 font-mono text-[14px] text-ink'
                  : 'absolute h-px w-px opacity-0'
              }
            />
            {isCameraScanSupported() && (
              <button
                onClick={async () => { const code = await scan(); if (code) onProductCode(code); }}
                disabled={scanning}
                aria-label="Scan with camera"
                className={
                  'flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-primary text-white disabled:opacity-60 ' +
                  (scanner.showInput ? 'w-[46px] flex-none' : 'flex-1 text-[13.5px] font-bold')
                }
              >
                <Camera size={18} strokeWidth={2} /> {!scanner.showInput && 'Scan with camera'}
              </button>
            )}
          </div>
          {isCameraScanSupported() && !scanner.showInput && (
            <button onClick={scanner.openManual} className="mt-2 flex items-center gap-1 text-[10.5px] font-bold text-secondary">
              <KeyboardIcon size={12} strokeWidth={2} /> Type the code instead
            </button>
          )}
          {cameraError && <div className="mt-2 text-[11.5px] text-danger">{cameraError}</div>}
          {canReceive && undoTop && (
            <button onClick={doUndo} className="mt-2 block text-[11px] font-bold text-danger underline underline-offset-2">
              Undo last: {undoTop.n > 0 ? '+' : ''}{undoTop.n} · {undoTop.name.length > 32 ? `${undoTop.name.slice(0, 32)}…` : undoTop.name}
            </button>
          )}
        </div>
      )}

      {r.lines.length > 0 && (
        <div className="flex rounded-xl bg-segtrack p-[3px]">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={
                'flex-1 rounded-[9px] py-1.5 text-[11.5px] font-bold ' +
                (filter === f.id ? 'bg-white text-ink shadow-seg' : 'text-secondary')
              }
            >
              {f.label} <span className="text-light">{totals.byFilter[f.id]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {shown.map((line) => (
          <ProductCard
            key={line.id}
            line={line}
            highlighted={highlight.includes(line.id)}
            onPhoto={openPhoto}
            onTap={canReceive ? () => setSheet({ kind: 'qty', line }) : undefined}
            entry={queue[line.id]}
            result={results[line.id]}
            onRetry={() => retryLine(line.id)}
            onDiscard={() => discardLine(line.id)}
            cardRef={(el) => { if (el) cardRefs.current.set(line.id, el); else cardRefs.current.delete(line.id); }}
          />
        ))}
        {r.lines.length > 0 && shown.length === 0 && (
          <div className="rounded-xl border border-dashed border-[rgba(148,163,184,.4)] p-4 text-center text-[12.5px] text-secondary">Nothing here.</div>
        )}
      </div>

      {sheet?.kind === 'qty' && (
        <QtySheet
          line={r.lines.find((l) => l.id === sheet.line.id) || sheet.line}
          onClose={() => setSheet(null)}
          onSave={(n) => { setUnits(sheet.line, n); setHighlight([sheet.line.id]); setSheet(null); }}
        />
      )}
      {sheet?.kind === 'choose' && (
        <Sheet onClose={() => setSheet(null)}>
          <div className="text-[14px] font-extrabold">Which product is it?</div>
          <div className="mt-0.5 text-[11.5px] text-secondary">This barcode belongs to more than one product in the reception.</div>
          <div className="mt-3 flex flex-col gap-2">
            {sheet.lines.map((l) => {
              const cur = r.lines.find((x) => x.id === l.id) || l;
              return (
                <button key={l.id} onClick={() => { setSheet(null); receiveOne(cur); }} className="flex items-center gap-2 rounded-xl border border-inputborder p-3 text-left">
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[13px] font-bold">{cur.name}</div>
                    <div className="font-mono text-[10.5px] text-secondary">{[cur.sku, cur.fnsku].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className="flex-none text-[14px] font-extrabold">{cur.shown}/{cur.expected}</div>
                </button>
              );
            })}
          </div>
        </Sheet>
      )}
      {sheet?.kind === 'over' && (
        <Sheet onClose={() => setSheet(null)}>
          <div className="flex gap-2.5">
            <TriangleAlert size={22} strokeWidth={2} className="mt-0.5 flex-none text-danger" />
            <div>
              <div className="text-[14px] font-extrabold">More than expected</div>
              <div className="mt-1 text-[12.5px] leading-snug text-secondary">
                {sheet.line.name}: the client announced {sheet.line.expected}, {sheet.line.shown} already received. Receive more anyway?
              </div>
            </div>
          </div>
          <div className="mt-4 flex gap-2.5">
            <button onClick={() => setSheet(null)} className="flex min-h-[50px] flex-1 items-center justify-center rounded-xl border border-inputborder text-[14px] font-bold">Cancel</button>
            <button
              onClick={() => {
                setOverOk((s) => new Set(s).add(sheet.line.id));
                addUnits(sheet.line, 1);
                setSheet(null);
              }}
              className="flex min-h-[50px] flex-[1.4] items-center justify-center rounded-xl bg-danger text-[14px] font-extrabold text-white"
            >
              Receive 1 more
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
