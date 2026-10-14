import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/AppContext';
import { useScanInput } from '../hooks/useScanInput';
import { useBarcodeScanner, isCameraScanSupported } from '../hooks/useBarcodeScanner';
import CameraScanOverlay from '../components/CameraScanOverlay';
import * as wh from '../lib/prepWarehouse';
import { matchLines } from '../lib/prepReceiving';
import { dayMonth } from '../components/ReceptionBits';
import { feedback } from '../lib/audio';
import { ScanLine, Camera, Keyboard as KeyboardIcon, MapPin, X, Plus, TriangleAlert, RefreshCw, ChevronLeft } from '../components/icons';

// Stock check: scan a product to see whose it is and where it sits, scan a
// shelf to see what is on it, and move goods between shelves (or back to the
// receiving area). Reads and moves go to the Prep-Center as the operator, with
// the website's own functions (lib/prepWarehouse.js). Moves need a connection:
// they act on the quantities the Prep-Center has right now.
//
// One barcode can belong to several clients. Every product card and every
// move names the client in large type with its own colour, and a code shared
// by several clients says so before anything else.

const OWNER_COLOURS = ['#1F6FEB', '#7C3AED', '#0D9488', '#C2410C', '#DB2777', '#4D7C0F'];

function errorText(reason, message) {
  if (reason === 'offline') return "Can't reach the Prep-Center — moves need a connection.";
  if (reason === 'expired' || reason === 'unauthorized') return 'Your Prep-Center session has ended. End the shift and scan your badge to sign in again.';
  if (reason === 'notShelf') return 'No shelf with this code in this warehouse.';
  return message || 'The Prep-Center returned an error. Try again.';
}

function Sheet({ children, onClose }) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end bg-[rgba(15,23,42,.45)]" onClick={onClose}>
      <div className="max-h-[92%] overflow-y-auto rounded-t-[20px] bg-white p-4 pb-6 animate-fadeUp" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function Photo({ src, size = 56 }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-none items-center justify-center overflow-hidden rounded-lg border border-[rgba(148,163,184,.25)] bg-page" style={{ width: size, height: size }}>
      {src && !failed
        ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-contain" />
        : <span className="text-[8.5px] font-bold uppercase text-light">No photo</span>}
    </div>
  );
}

function Codes({ item }) {
  const list = [['EAN', item?.ean], ['ASIN', item?.asin], ['FNSKU', item?.fnsku], ['SKU', item?.sku]].filter(([, v]) => v);
  if (!list.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {list.map(([k, v]) => (
        <span key={k} className="inline-flex max-w-full items-center gap-1 rounded-md bg-segtrack px-1.5 py-[1px] font-mono text-[10px] text-ink">
          <span className="font-sans text-[8.5px] font-extrabold text-secondary">{k}</span><span className="truncate">{v}</span>
        </span>
      ))}
    </div>
  );
}

function ClientTag({ name, colour, big }) {
  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${big ? 'text-[15px]' : 'text-[12.5px]'} font-extrabold`} style={{ color: colour }}>
      <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: colour }} />
      <span className="truncate">{name}</span>
    </div>
  );
}

function LocationLine({ loc, onShelf, onMove, onUnassign }) {
  return (
    <div className="flex items-center gap-2 border-t border-[rgba(148,163,184,.15)] py-2 first:border-t-0">
      <button onClick={onShelf} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <MapPin size={13} strokeWidth={2.2} className={loc.placeActive ? 'flex-none text-success-dark' : 'flex-none text-danger'} />
        <span className="font-mono text-[13px] font-extrabold text-ink underline decoration-dotted underline-offset-2">{loc.code}</span>
        <span className="text-[13px] font-extrabold text-ink">×{loc.qty}</span>
        {(loc.lot || loc.expiry) && (
          <span className="truncate text-[10.5px] text-secondary">
            {[loc.lot && `lot ${loc.lot}`, loc.expiry && `exp ${loc.expiry}`].filter(Boolean).join(' · ')}
          </span>
        )}
      </button>
      <button onClick={onUnassign} aria-label="Back to receiving area" className="flex-none rounded-lg border border-inputborder px-2 py-1 text-[11px] font-bold text-secondary">↩︎</button>
      <button onClick={onMove} className="flex-none rounded-lg bg-primary px-2.5 py-1 text-[11.5px] font-bold text-white">Move</button>
    </div>
  );
}

// ---------------------------------------------------------------- product view

function ProductView({ data, code, country, onShelf, onMove, onUnassign, onPut }) {
  // Only clients who have the product here: stock in this country, or units
  // physically on a shelf. Owners with no stock (and announced-only products)
  // are left out.
  const owners = data.owners.filter((o) => o.stock > 0 || o.onShelves > 0);
  if (!owners.length) {
    return (
      <div className="rounded-xl border border-[rgba(255,122,0,.35)] bg-[rgba(255,122,0,.07)] p-3 text-[12.5px] text-ink">
        {data.owners.length
          ? <>No client has <span className="font-mono font-bold">{code || 'this product'}</span> in stock in {country}.</>
          : <>No client has a product with code <span className="font-mono font-bold">{code}</span> on the Prep-Center.</>}
      </div>
    );
  }
  const shared = owners.length > 1;
  return (
    <div className="flex flex-col gap-3">
      {shared && (
        <div className="flex gap-2.5 rounded-xl border border-[rgba(255,122,0,.45)] bg-[rgba(255,122,0,.1)] p-3">
          <TriangleAlert size={18} strokeWidth={2} className="mt-0.5 flex-none text-accent-dark" />
          <div className="text-[12.5px] leading-snug text-ink">
            <b>{owners.length} clients</b> have this product. Each client's stock is shown separately — check the client before moving anything.
          </div>
        </div>
      )}
      {owners.map((o, i) => {
        const colour = OWNER_COLOURS[i % OWNER_COLOURS.length];
        return (
          <div key={o.key} className="overflow-hidden rounded-2xl border bg-white shadow-card" style={{ borderColor: colour }}>
            <div className="flex items-center gap-2 px-3.5 py-2" style={{ background: `${colour}14` }}>
              <ClientTag name={o.client} colour={colour} big />
              {shared && <span className="ml-auto flex-none text-[10px] font-bold uppercase text-secondary">client {i + 1} of {owners.length}</span>}
            </div>
            <div className="p-3.5 pt-3">
              <div className="flex gap-3">
                <Photo src={o.item?.image_url} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[13px] font-bold leading-snug">{o.item?.name || 'Product'}</div>
                  <Codes item={o.item} />
                </div>
              </div>
              {o.item?.id && (
                <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
                  <div className="rounded-lg bg-segtrack py-1.5"><div className="text-[16px] font-extrabold">{o.stock}</div><div className="text-[9px] font-bold uppercase text-secondary">stock {country}</div></div>
                  <div className="rounded-lg bg-success-tint2 py-1.5"><div className="text-[16px] font-extrabold text-success-dark">{o.onShelves}</div><div className="text-[9px] font-bold uppercase text-secondary">on shelves</div></div>
                  <div className={`rounded-lg py-1.5 ${o.notOnShelf ? 'bg-[rgba(255,122,0,.1)]' : 'bg-segtrack'}`}><div className={`text-[16px] font-extrabold ${o.notOnShelf ? 'text-accent-dark' : ''}`}>{o.notOnShelf}</div><div className="text-[9px] font-bold uppercase text-secondary">not on a shelf</div></div>
                </div>
              )}
              {o.notOnShelf > 0 && (
                <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-[rgba(255,122,0,.08)] px-2.5 py-2">
                  <div className="min-w-0 flex-1 text-[12px] leading-snug text-ink">
                    <b className="text-accent-dark">{o.notOnShelf} not on a shelf</b>
                  </div>
                  {o.placeable > 0 && (
                    <button onClick={() => onPut({ owner: o, colour })} className="flex-none rounded-lg bg-accent px-2.5 py-1.5 text-[11.5px] font-extrabold text-white">
                      Put on shelf
                    </button>
                  )}
                </div>
              )}
              {o.locations.length > 0 ? (
                <div className="mt-2.5">
                  {o.locations.map((loc) => (
                    <LocationLine
                      key={loc.id}
                      loc={loc}
                      onShelf={() => onShelf(loc.code)}
                      onMove={() => onMove({ loc, name: o.item?.name, client: o.client, clientId: loc.clientId || o.clientId, colour, image: o.item?.image_url })}
                      onUnassign={() => onUnassign({ loc, name: o.item?.name, client: o.client, colour, image: o.item?.image_url })}
                    />
                  ))}
                </div>
              ) : o.item?.id ? (
                <div className="mt-2.5 text-[12px] text-secondary">Not on any shelf in {country}.</div>
              ) : null}
              {o.expected.length > 0 && (
                <div className="mt-2.5 rounded-lg bg-[rgba(31,111,235,.07)] px-2.5 py-2">
                  {o.expected.map((e) => (
                    <div key={e.receptionId} className="text-[11.5px] text-ink">
                      <b className="text-primary">{e.expected - e.received} expected</b> in reception #{String(e.receptionId).slice(0, 8)}
                      {e.tracking ? ` · ${e.tracking}` : ''} · announced {dayMonth(e.announced)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ shelf view

function ShelfView({ data, onProduct, onMove, onUnassign, onMoveAll, onQuickMove }) {
  const { shelf, groups } = data;
  const units = groups.reduce((a, g) => a + g.rows.reduce((b, r) => b + r.qty, 0), 0);
  const products = groups.reduce((a, g) => a + g.rows.length, 0);
  const status = !shelf.active ? ['Blocked / inactive', 'bg-danger-tint text-danger-dark']
    : shelf.claim?.status === 'empty_pending_check' ? ['Verify empty', 'bg-[rgba(255,122,0,.12)] text-accent-dark']
      : shelf.claim?.status === 'conflict' ? ['Conflict', 'bg-danger-tint text-danger-dark']
        : units === 0 ? ['Free', 'bg-success-tint text-success-dark'] : ['In use', 'bg-[rgba(31,111,235,.1)] text-primary'];
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-[rgba(148,163,184,.25)] bg-white p-3.5 shadow-card">
        <div className="flex items-center gap-2">
          <MapPin size={20} strokeWidth={2.1} className="flex-none text-primary" />
          <div className="font-mono text-[20px] font-extrabold tracking-[-.01em]">{shelf.code}</div>
          <span className={`rounded-full px-2 py-[3px] text-[10px] font-extrabold uppercase ${status[1]}`}>{status[0]}</span>
        </div>
        <div className="mt-1 text-[12px] text-secondary">{units} unit{units === 1 ? '' : 's'} · {products} product{products === 1 ? '' : 's'}</div>
        {units > 0 && (
          <div className="mt-3 flex gap-2">
            <button onClick={onQuickMove} className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-[13px] font-extrabold text-white">
              <ScanLine size={16} strokeWidth={2.2} /> Quick move
            </button>
            <button onClick={onMoveAll} className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-inputborder text-[13px] font-bold text-ink">
              Move everything
            </button>
          </div>
        )}
      </div>
      {groups.length > 1 && (
        <div className="flex gap-2.5 rounded-xl border border-[rgba(255,122,0,.45)] bg-[rgba(255,122,0,.1)] p-3 text-[12.5px] leading-snug text-ink">
          <TriangleAlert size={18} strokeWidth={2} className="mt-0.5 flex-none text-accent-dark" />
          This shelf holds goods of {groups.length} clients.
        </div>
      )}
      {units === 0 && (
        <div className="rounded-xl border border-dashed border-[rgba(148,163,184,.4)] p-4 text-center text-[12.5px] text-secondary">Nothing on this shelf.</div>
      )}
      {groups.map((g, gi) => {
        const colour = OWNER_COLOURS[gi % OWNER_COLOURS.length];
        return (
          <div key={g.clientId || gi} className="overflow-hidden rounded-2xl border bg-white shadow-card" style={{ borderColor: colour }}>
            <div className="px-3.5 py-2" style={{ background: `${colour}14` }}><ClientTag name={g.client} colour={colour} big /></div>
            <div className="px-3.5">
              {g.rows.map((r) => (
                <div key={r.id} className="flex items-center gap-2.5 border-t border-[rgba(148,163,184,.15)] py-2.5 first:border-t-0">
                  <button onClick={() => r.stockItemId && onProduct(r.stockItemId)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                    <Photo src={r.image} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-[12.5px] font-bold leading-snug">{r.name}</div>
                      <div className="truncate font-mono text-[10px] text-secondary">
                        {[r.ean, r.fnsku || r.sku, r.lot && `lot ${r.lot}`, r.expiry && `exp ${r.expiry}`].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="flex-none text-[16px] font-extrabold">×{r.qty}</div>
                  </button>
                  <div className="flex flex-none flex-col gap-1">
                    <button onClick={() => onMove({ loc: r, name: r.name, client: g.client, clientId: r.clientId || g.clientId, colour, image: r.image })} className="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-bold text-white">Move</button>
                    <button onClick={() => onUnassign({ loc: r, name: r.name, client: g.client, colour, image: r.image })} aria-label="Back to receiving area" className="rounded-lg border border-inputborder px-2 py-[3px] text-[10.5px] font-bold text-secondary">↩︎ Recv.</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --------------------------------------------------------------------- sheets

function QtyPicker({ value, max, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onChange(Math.max(1, value - 1))} className="flex h-12 w-12 flex-none items-center justify-center rounded-xl border border-inputborder text-[24px] font-bold">−</button>
      <input
        inputMode="numeric"
        value={String(value)}
        onChange={(e) => onChange(Math.min(max, Math.max(0, Math.floor(Number(e.target.value.replace(/[^0-9]/g, '')) || 0))))}
        onFocus={(e) => e.target.select()}
        className="min-h-[48px] min-w-0 flex-1 rounded-xl border-2 border-primary text-center text-[22px] font-extrabold"
      />
      <button onClick={() => onChange(Math.min(max, value + 1))} className="flex h-12 w-12 flex-none items-center justify-center rounded-xl border border-inputborder"><Plus size={22} /></button>
      <button onClick={() => onChange(max)} className="flex h-12 flex-none items-center justify-center rounded-xl border border-inputborder px-3 text-[12.5px] font-bold">All {max}</button>
    </div>
  );
}

// Camera button next to a shelf/product field: opens the camera scanner and
// hands back the code it read. Phones only (Zebra scans with its own engine).
function CameraButton({ onCode, disabled }) {
  const { scan, scanning, cancel } = useBarcodeScanner();
  if (!isCameraScanSupported()) return null;
  return (
    <>
      {scanning && <CameraScanOverlay onCancel={cancel} />}
      <button
        type="button"
        onClick={async () => { const c = await scan(); if (c) onCode(c); }}
        disabled={disabled || scanning}
        aria-label="Scan with camera"
        className="flex min-h-[48px] w-[48px] flex-none items-center justify-center rounded-xl bg-primary text-white disabled:opacity-60"
      >
        <Camera size={19} strokeWidth={2} />
      </button>
    </>
  );
}

/**
 * Moves one or more shelf rows to one destination. `rows`: [{ loc, qty, name,
 * client, clientId, colour }]. The destination is checked for every client
 * among them; each row is moved with its own key, kept across a retry.
 */
function MoveSheet({ title, rows: initialRows, editableQty, country, withPrep, onClose, onDone, initialDest = '' }) {
  const [rows, setRows] = useState(initialRows);
  const [dest, setDest] = useState(initialDest);
  const [checked, setChecked] = useState(null); // { shelf } | { error }
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState({}); // loc.id -> 'done' | message
  const keysRef = useRef({});

  const check = async (e, scanned) => {
    e?.preventDefault();
    const code = (scanned ?? dest).trim();
    if (!code || busy) return;
    setBusy(true);
    setChecked(null);
    // Every client among the rows must be allowed on the destination.
    const clients = [...new Set(rows.map((r) => r.clientId || ''))];
    let shelf = null;
    for (const clientId of clients) {
      const res = await withPrep((t) => wh.checkDestination(t, { code, country, clientId }));
      if (!res.ok) { setChecked({ error: errorText(res.reason, res.message) }); setBusy(false); return; }
      shelf = res.shelf;
    }
    if (rows.some((r) => r.loc.placeId === shelf.id)) {
      setChecked({ error: `That is the shelf the goods are already on (${shelf.code}).` });
    } else {
      setChecked({ shelf });
      keysRef.current = {};
    }
    setBusy(false);
  };

  // A destination already scanned (Quick move) is checked straight away.
  const autoChecked = useRef(false);
  useEffect(() => {
    if (initialDest && !autoChecked.current) { autoChecked.current = true; check(); }
  });

  const confirm = async () => {
    if (!checked?.shelf) return;
    setBusy(true);
    const next = { ...results };
    for (const r of rows) {
      if (next[r.loc.id] === 'done' || !r.qty) continue;
      keysRef.current[r.loc.id] ||= wh.newMoveKey('relocate');
      const res = await withPrep((t) => wh.relocate(t, { locationId: r.loc.id, toPlaceId: checked.shelf.id, qty: r.qty, key: keysRef.current[r.loc.id] }));
      next[r.loc.id] = res.ok ? 'done' : errorText(res.reason, res.message);
      setResults({ ...next });
    }
    setBusy(false);
    const failed = rows.filter((r) => r.qty && next[r.loc.id] !== 'done');
    feedback(failed.length > 0);
    if (!failed.length) onDone(`Moved to ${checked.shelf.code}`);
  };

  const total = rows.reduce((a, r) => a + r.qty, 0);
  const anyDone = Object.values(results).some((v) => v === 'done');

  return (
    <Sheet onClose={busy ? undefined : () => (anyDone ? onDone() : onClose())}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 text-[15px] font-extrabold">{title}</div>
        {!busy && <button onClick={() => (anyDone ? onDone() : onClose())} aria-label="Close" className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-light"><X size={17} /></button>}
      </div>
      <div className="mt-2 flex max-h-[38vh] flex-col gap-2 overflow-y-auto">
        {rows.map((r, i) => (
          <div key={r.loc.id} className="rounded-xl border p-2.5" style={{ borderColor: r.colour }}>
            <ClientTag name={r.client} colour={r.colour} />
            <div className="mt-1 flex items-center gap-2">
              <Photo src={r.image} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-bold">{r.name}</div>
                <div className="font-mono text-[10.5px] text-secondary">from {r.loc.code} · {r.loc.qty} there{r.loc.lot ? ` · lot ${r.loc.lot}` : ''}</div>
              </div>
              {!editableQty && <div className="flex-none text-[15px] font-extrabold">×{r.qty}</div>}
            </div>
            {editableQty && (
              <div className="mt-2">
                <QtyPicker value={r.qty} max={r.loc.qty} onChange={(v) => { setRows((rs) => rs.map((x, j) => (j === i ? { ...x, qty: v } : x))); keysRef.current = {}; }} />
              </div>
            )}
            {results[r.loc.id] && (
              <div className={`mt-1 text-[11.5px] font-bold ${results[r.loc.id] === 'done' ? 'text-success-dark' : 'text-danger'}`}>
                {results[r.loc.id] === 'done' ? `Moved ${r.qty} ✓` : results[r.loc.id]}
              </div>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={check} className="mt-3">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-[.08em] text-light">Scan or type the destination shelf</div>
        <div className="flex gap-2">
          <input
            autoFocus
            value={dest}
            onChange={(e) => { setDest(e.target.value); setChecked(null); }}
            autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            placeholder="e.g. E-4"
            className="min-h-[48px] min-w-0 flex-1 rounded-xl border-2 border-primary px-3.5 font-mono text-[16px] uppercase"
          />
          <CameraButton disabled={busy} onCode={(c) => { setDest(c); check(null, c); }} />
          <button type="submit" disabled={!dest.trim() || busy} className="flex-none rounded-xl border border-inputborder px-3.5 text-[13px] font-bold text-primary disabled:text-light">Check</button>
        </div>
        {checked?.error && <div className="mt-1.5 text-[12px] font-bold text-danger">{checked.error}</div>}
      </form>

      <button
        onClick={confirm}
        disabled={!checked?.shelf || busy || total === 0}
        className="mt-3 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-[14.5px] font-extrabold text-white disabled:opacity-50"
      >
        {busy ? 'Moving…' : checked?.shelf
          ? <>Move {total} unit{total === 1 ? '' : 's'}: {[...new Set(rows.map((r) => r.loc.code))].join(', ')} → {checked.shelf.code}</>
          : 'Check the destination shelf first'}
      </button>
    </Sheet>
  );
}

// Units in stock but on no shelf → a shelf: through the receptions they came in
// by, the rest (added in the portal, imported…) as a manual placement.
function PutSheet({ target, country, withPrep, onClose, onDone }) {
  const { owner, colour } = target;
  const [qty, setQty] = useState(owner.placeable);
  const [dest, setDest] = useState('');
  const [checked, setChecked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const keysRef = useRef({});
  const clientId = owner.sources[0]?.clientId || owner.clientId;

  const check = async (e, scanned) => {
    e?.preventDefault();
    const code = (scanned ?? dest).trim();
    if (!code || busy) return;
    setBusy(true); setChecked(null); setError(null);
    const res = await withPrep((t) => wh.checkDestination(t, { code, country, clientId }));
    setBusy(false);
    if (res.ok) { setChecked(res.shelf); keysRef.current = {}; } else setError(errorText(res.reason, res.message));
  };
  const go = async () => {
    setBusy(true); setError(null);
    const res = await withPrep((t) => wh.putOnShelf(t, { owner, qty, shelf: checked, keys: keysRef.current }));
    setBusy(false);
    feedback(!res.ok);
    if (res.ok) onDone(`${res.placed} put on ${checked.code}`);
    else setError(`${res.placed ? `${res.placed} placed, then: ` : ''}${errorText(res.reason, res.message)}`);
  };
  return (
    <Sheet onClose={busy ? undefined : onClose}>
      <div className="text-[15px] font-extrabold">Put on a shelf</div>
      <div className="mt-0.5 text-[11.5px] text-secondary">Units already in stock, not on any shelf. The stock does not change.</div>
      <div className="mt-3 rounded-xl border p-2.5" style={{ borderColor: colour }}>
        <ClientTag name={owner.client} colour={colour} />
        <div className="mt-1 flex items-center gap-2">
          <Photo src={owner.item?.image_url} size={36} />
          <div className="min-w-0 flex-1 truncate text-[12.5px] font-bold">{owner.item?.name}</div>
        </div>
      </div>
      <div className="mt-3"><QtyPicker value={qty} max={owner.placeable} onChange={(v) => { setQty(v); keysRef.current = {}; }} /></div>
      <form onSubmit={check} className="mt-3">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-[.08em] text-light">Scan or type the shelf</div>
        <div className="flex gap-2">
          <input
            autoFocus value={dest} onChange={(e) => { setDest(e.target.value); setChecked(null); }}
            autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="e.g. E-4"
            className="min-h-[48px] min-w-0 flex-1 rounded-xl border-2 border-primary px-3.5 font-mono text-[16px] uppercase"
          />
          <CameraButton disabled={busy} onCode={(c) => { setDest(c); check(null, c); }} />
          <button type="submit" disabled={!dest.trim() || busy} className="flex-none rounded-xl border border-inputborder px-3.5 text-[13px] font-bold text-primary disabled:text-light">Check</button>
        </div>
      </form>
      {error && <div className="mt-2 text-[12px] font-bold text-danger">{error}</div>}
      <button onClick={go} disabled={!checked || busy || !qty} className="mt-3 flex min-h-[52px] w-full items-center justify-center rounded-xl bg-accent text-[14.5px] font-extrabold text-white disabled:opacity-50">
        {busy ? 'Saving…' : checked ? `Put ${qty} on ${checked.code}` : 'Check the shelf first'}
      </button>
    </Sheet>
  );
}

function UnassignSheet({ target, withPrep, onClose, onDone }) {
  const [qty, setQty] = useState(target.loc.qty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const keyRef = useRef(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    keyRef.current ||= wh.newMoveKey('unassign');
    const res = await withPrep((t) => wh.unassign(t, { locationId: target.loc.id, qty, key: keyRef.current }));
    setBusy(false);
    feedback(!res.ok);
    if (res.ok) onDone(`${qty} back in the receiving area`);
    else setError(errorText(res.reason, res.message));
  };
  return (
    <Sheet onClose={busy ? undefined : onClose}>
      <div className="text-[15px] font-extrabold">Back to the receiving area</div>
      <div className="mt-0.5 text-[11.5px] text-secondary">Takes the units off the shelf without changing the stock — as on the website.</div>
      <div className="mt-3 rounded-xl border p-2.5" style={{ borderColor: target.colour }}>
        <ClientTag name={target.client} colour={target.colour} />
        <div className="mt-1 truncate text-[12.5px] font-bold">{target.name}</div>
        <div className="font-mono text-[10.5px] text-secondary">on {target.loc.code} · {target.loc.qty} there</div>
      </div>
      <div className="mt-3"><QtyPicker value={qty} max={target.loc.qty} onChange={(v) => { setQty(v); keyRef.current = null; }} /></div>
      {error && <div className="mt-2 text-[12px] font-bold text-danger">{error}</div>}
      <button onClick={go} disabled={busy || !qty} className="mt-3 flex min-h-[52px] w-full items-center justify-center rounded-xl bg-ink text-[14.5px] font-extrabold text-white disabled:opacity-50">
        {busy ? 'Saving…' : `Take ${qty} off ${target.loc.code}`}
      </button>
    </Sheet>
  );
}

/**
 * Quick move from one shelf: scan what you take (each scan = 1 unit), then
 * scan the destination. A code on several rows of this shelf (another client,
 * another lot) asks which one.
 */
function QuickMove({ shelfData, country, withPrep, showToast, onClose, onDone }) {
  const rows = useMemo(() => shelfData.groups.flatMap((g, gi) => g.rows.map((r) => ({
    ...r, client: g.client, clientId: r.clientId || g.clientId, colour: OWNER_COLOURS[gi % OWNER_COLOURS.length],
    // matchLines() field names
    eanAsin: r.asin, internalCode: null,
  }))), [shelfData]);
  const [picked, setPicked] = useState({}); // loc id -> qty
  const [choose, setChoose] = useState(null);
  const [moving, setMoving] = useState(null);

  const pick = useCallback((row) => {
    setPicked((p) => {
      const cur = p[row.id] || 0;
      if (cur >= row.qty) { feedback(true); showToast(`Only ${row.qty} of this on ${row.code}`); return p; }
      feedback(false);
      return { ...p, [row.id]: cur + 1 };
    });
  }, [showToast]);

  const onCode = (code) => {
    const hits = matchLines(rows, code);
    if (hits.length === 1) pick(hits[0]);
    else if (hits.length > 1) { feedback(false); setChoose(hits); }
    else if (Object.keys(picked).length) {
      // Not a product here: take it as the destination shelf.
      setMoving({ dest: code });
    } else {
      feedback(true);
      showToast(`${code} is not on shelf ${shelfData.shelf.code}`);
    }
  };
  const scanner = useScanInput(onCode, { paused: !!choose || !!moving });
  const pickedRows = rows.filter((r) => picked[r.id]);
  const total = pickedRows.reduce((a, r) => a + picked[r.id], 0);

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-page">
      <div className="flex items-center gap-2 border-b border-[rgba(148,163,184,.25)] bg-white px-3.5 py-3">
        <button onClick={onClose} aria-label="Close" className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-[rgba(148,163,184,.3)]"><X size={16} /></button>
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold">Quick move from {shelfData.shelf.code}</div>
          <div className="text-[10.5px] text-secondary">Scan each unit you take, then scan the destination shelf</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3">
        <div className={scanner.showInput || isCameraScanSupported() ? 'mb-3 flex gap-2' : ''}>
          <input {...scanner.inputProps} placeholder="Product barcode…" className={scanner.showInput ? 'min-h-[46px] min-w-0 flex-1 rounded-xl border-2 border-primary px-3 font-mono text-[14px]' : 'absolute h-px w-px opacity-0'} />
          {!scanner.showInput && isCameraScanSupported() && <div className="flex-1 self-center text-[11.5px] text-secondary">Scan each unit, then the destination shelf</div>}
          <CameraButton disabled={!!choose || !!moving} onCode={onCode} />
        </div>
        {!scanner.showInput && (
          <button onClick={scanner.openManual} className="mb-2 flex items-center gap-1 text-[10.5px] font-bold text-secondary"><KeyboardIcon size={12} strokeWidth={2} /> Type a code instead</button>
        )}
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.id} className={`flex items-center gap-2.5 rounded-xl border bg-white p-2.5 ${picked[r.id] ? '' : 'opacity-60'}`} style={{ borderColor: picked[r.id] ? r.colour : 'rgba(148,163,184,.25)' }}>
              <Photo src={r.image} size={40} />
              <div className="min-w-0 flex-1">
                <ClientTag name={r.client} colour={r.colour} />
                <div className="truncate text-[12px] font-bold">{r.name}</div>
                {r.lot && <div className="font-mono text-[10px] text-secondary">lot {r.lot}</div>}
              </div>
              <div className="flex flex-none items-center gap-1">
                <button onClick={() => setPicked((p) => { const n = (p[r.id] || 0) - 1; const { [r.id]: _x, ...rest } = p; return n > 0 ? { ...p, [r.id]: n } : rest; })} className="h-8 w-8 rounded-lg border border-inputborder text-[18px] font-bold">−</button>
                <div className="w-14 text-center text-[14px] font-extrabold">{picked[r.id] || 0}<span className="text-[11px] text-light">/{r.qty}</span></div>
                <button onClick={() => setPicked((p) => ({ ...p, [r.id]: r.qty }))} className="h-8 rounded-lg border border-inputborder px-2 text-[11px] font-bold">All</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-[rgba(148,163,184,.25)] bg-white p-3.5">
        <button
          onClick={() => setMoving({ dest: '' })}
          disabled={!total}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[14.5px] font-extrabold text-white disabled:opacity-50"
        >
          <MapPin size={17} /> {total ? `Move ${total} unit${total === 1 ? '' : 's'} — choose destination` : 'Scan the units you take'}
        </button>
      </div>

      {choose && (
        <Sheet onClose={() => setChoose(null)}>
          <div className="text-[14px] font-extrabold">Which one did you take?</div>
          <div className="mt-0.5 text-[11.5px] text-secondary">This barcode is on this shelf more than once — check the client.</div>
          <div className="mt-3 flex flex-col gap-2">
            {choose.map((r) => (
              <button key={r.id} onClick={() => { pick(r); setChoose(null); }} className="rounded-xl border p-2.5 text-left" style={{ borderColor: r.colour }}>
                <ClientTag name={r.client} colour={r.colour} big />
                <div className="mt-0.5 truncate text-[12px]">{r.name}{r.lot ? ` · lot ${r.lot}` : ''} · {r.qty} on shelf</div>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {moving && (
        <MoveSheet
          initialDest={moving.dest}
          editableQty={false}
          title={`Move ${total} unit${total === 1 ? '' : 's'} from ${shelfData.shelf.code}`}
          rows={pickedRows.map((r) => ({ loc: r, qty: picked[r.id], name: r.name, client: r.client, clientId: r.clientId, colour: r.colour, image: r.image }))}
          country={country}
          withPrep={withPrep}
          onClose={() => setMoving(null)}
          onDone={onDone}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------- screen

export default function StockCheck() {
  const { shift, withPrep, showToast } = useApp();
  const country = shift?.country;
  // Views visited, newest last: { kind: 'product', code, stockItemId } | { kind: 'shelf', code, id }
  const [stack, setStack] = useState([]);
  const [data, setData] = useState(null); // result for the top view
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sheet, setSheet] = useState(null); // { kind: 'move'|'unassign'|'moveAll'|'quick', ... }
  const { scan, scanning, error: cameraError, cancel: cancelCamera } = useBarcodeScanner();
  const view = stack[stack.length - 1] || null;
  const reqRef = useRef(0);

  const load = useCallback(async (v) => {
    const req = ++reqRef.current;
    setLoading(true);
    setError(null);
    let res;
    if (v.kind === 'shelf') {
      res = await withPrep((t) => wh.lookupShelf(t, { code: v.code, id: v.id, country }));
    } else if (v.kind === 'product') {
      res = await withPrep((t) => wh.lookupProduct(t, { code: v.code, stockItemId: v.stockItemId, country }));
    } else {
      // A scan: a shelf of this warehouse if the code is one, else a product.
      res = await withPrep((t) => wh.lookupShelf(t, { code: v.code, country }));
      if (res.ok) v = { kind: 'shelf', code: v.code };
      else if (res.reason === 'notShelf') {
        v = { kind: 'product', code: v.code };
        res = await withPrep((t) => wh.lookupProduct(t, { code: v.code, country }));
      }
    }
    if (req !== reqRef.current) return null;
    setLoading(false);
    if (!res.ok) { setError(errorText(res.reason, res.message)); feedback(true); return null; }
    feedback(v.kind === 'product' && !res.owners.some((o) => o.stock > 0 || o.onShelves > 0));
    setData(res);
    return v;
  }, [withPrep, country]);

  const open = useCallback(async (v, { replace = false } = {}) => {
    const resolved = await load(v);
    if (!resolved) return;
    setStack((s) => (replace ? [...s.slice(0, -1), resolved] : [...s.slice(-9), resolved]));
  }, [load]);

  const back = () => {
    const prev = stack[stack.length - 2];
    if (!prev) { setStack([]); setData(null); return; }
    setStack((s) => s.slice(0, -1));
    load(prev);
  };
  const reload = () => view && load(view);

  const scanner = useScanInput((code) => open({ kind: 'scan', code }), { paused: scanning || !!sheet || loading });

  const moveDone = (msg) => {
    setSheet(null);
    if (msg) showToast(msg);
    reload();
  };

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-[22px] pt-3.5">
      {scanning && <CameraScanOverlay onCancel={cancelCamera} />}

      <div className="rounded-2xl border border-[rgba(31,111,235,.25)] bg-white p-3.5 shadow-card">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary text-white"><ScanLine size={22} strokeWidth={1.9} /></div>
          <div className="min-w-0">
            <div className="text-[15px] font-extrabold tracking-[-.015em]">Scan a product or a shelf</div>
            <div className="text-[11.5px] leading-snug text-secondary">{loading ? 'Looking it up on the Prep-Center…' : `Whose it is, where it sits · ${country || ''} warehouse`}</div>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <input
            {...scanner.inputProps}
            placeholder="EAN, FNSKU, SKU or shelf code…"
            className={scanner.showInput ? 'min-h-[50px] min-w-0 flex-1 rounded-xl border-2 border-primary bg-white px-3.5 font-mono text-[15px] text-ink' : 'absolute h-px w-px opacity-0'}
          />
          {isCameraScanSupported() && (
            <button
              onClick={async () => { const c = await scan(); if (c) open({ kind: 'scan', code: c }); }}
              disabled={scanning || loading}
              aria-label="Scan with camera"
              className={'flex min-h-[50px] items-center justify-center gap-2 rounded-xl bg-primary text-white disabled:opacity-60 ' + (scanner.showInput ? 'w-[50px] flex-none' : 'flex-1 text-[14px] font-bold')}
            >
              <Camera size={19} strokeWidth={2} /> {!scanner.showInput && 'Scan with camera'}
            </button>
          )}
        </div>
        {isCameraScanSupported() && !scanner.showInput && (
          <button onClick={scanner.openManual} className="mt-2 flex items-center gap-1 text-[10.5px] font-bold text-secondary"><KeyboardIcon size={12} strokeWidth={2} /> Type a code instead</button>
        )}
        {cameraError && <div className="mt-2 text-[11.5px] text-danger">{cameraError}</div>}
      </div>

      {view && (
        <div className="flex items-center gap-2">
          {stack.length > 1 && (
            <button onClick={back} className="flex items-center gap-0.5 text-[12px] font-bold text-primary"><ChevronLeft size={15} /> Back</button>
          )}
          <div className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-[.1em] text-light">
            {view.kind === 'shelf' ? 'Shelf' : 'Product'} · <span className="font-mono normal-case tracking-normal">{view.code || (data?.owners?.[0]?.item?.name) || ''}</span>
          </div>
          <button onClick={reload} disabled={loading} aria-label="Refresh" className="flex h-7 w-7 items-center justify-center rounded-full text-secondary disabled:opacity-50">
            <RefreshCw size={14} strokeWidth={2.2} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      )}

      {error && <div className="rounded-xl border border-danger/30 bg-danger-tint2 p-3 text-[12.5px] text-danger-dark">{error}</div>}

      {!view && !error && (
        <div className="rounded-xl border border-dashed border-[rgba(148,163,184,.4)] p-4 text-[12.5px] leading-relaxed text-secondary">
          <b className="text-ink">Product</b> — whose it is (one card per client), how much is in stock, on which shelves, and what is still expected.<br />
          <b className="text-ink">Shelf</b> — what is on it, per client. From there: <b className="text-ink">Quick move</b> or move everything to another shelf.
        </div>
      )}

      {view?.kind === 'product' && data?.owners && (
        <ProductView
          data={data}
          code={view.code}
          country={country}
          onShelf={(code) => open({ kind: 'shelf', code })}
          onMove={(t) => setSheet({ kind: 'move', rows: [{ ...t, qty: t.loc.qty }] })}
          onUnassign={(t) => setSheet({ kind: 'unassign', target: t })}
          onPut={(t) => setSheet({ kind: 'put', target: t })}
        />
      )}
      {view?.kind === 'shelf' && data?.shelf && (
        <ShelfView
          data={data}
          onProduct={(stockItemId) => open({ kind: 'product', stockItemId })}
          onMove={(t) => setSheet({ kind: 'move', rows: [{ ...t, qty: t.loc.qty }] })}
          onUnassign={(t) => setSheet({ kind: 'unassign', target: t })}
          onMoveAll={() => setSheet({
            kind: 'moveAll',
            rows: data.groups.flatMap((g, gi) => g.rows.map((r) => ({
              loc: r, qty: r.qty, name: r.name, client: g.client, clientId: r.clientId || g.clientId,
              colour: OWNER_COLOURS[gi % OWNER_COLOURS.length], image: r.image,
            }))),
          })}
          onQuickMove={() => setSheet({ kind: 'quick' })}
        />
      )}

      {sheet?.kind === 'move' && (
        <MoveSheet title="Move to another shelf" rows={sheet.rows} editableQty country={country} withPrep={withPrep} onClose={() => setSheet(null)} onDone={moveDone} />
      )}
      {sheet?.kind === 'moveAll' && (
        <MoveSheet title={`Move everything from ${data.shelf.code}`} rows={sheet.rows} editableQty={false} country={country} withPrep={withPrep} onClose={() => setSheet(null)} onDone={moveDone} />
      )}
      {sheet?.kind === 'put' && (
        <PutSheet target={sheet.target} country={country} withPrep={withPrep} onClose={() => setSheet(null)} onDone={moveDone} />
      )}
      {sheet?.kind === 'unassign' && (
        <UnassignSheet target={sheet.target} withPrep={withPrep} onClose={() => setSheet(null)} onDone={moveDone} />
      )}
      {sheet?.kind === 'quick' && data?.shelf && (
        <QuickMove shelfData={data} country={country} withPrep={withPrep} showToast={showToast} onClose={() => setSheet(null)} onDone={moveDone} />
      )}
    </div>
  );
}

