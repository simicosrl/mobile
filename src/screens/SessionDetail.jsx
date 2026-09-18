import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { Download, Printer } from '../components/icons';

export default function SessionDetail() {
  const { history, selectedDocNo, historyQuery, printDocument, printDdt, openPhoto, lookupNoted } = useApp();
  const sel = history.find((h) => h.doc === selectedDocNo);

  // Which delivery note each box actually travels on.
  //
  // A session can legitimately end with no note of its own, because every box
  // on it had already shipped on an earlier one. Looking at that session a day
  // later, the screen showed nothing at all — no notes, no reason — which reads
  // as the app having failed to do its job. It is asked of the database rather
  // than kept locally so it is the same answer on any device, including one
  // that never saw the session being closed.
  const [noted, setNoted] = useState(null);
  const codes = (sel?.parcels || []).map((p) => p.code).join(',');
  useEffect(() => {
    let cancelled = false;
    if (!sel || sel.direction !== 'out' || !codes) { setNoted(null); return undefined; }
    (async () => {
      const map = await lookupNoted(codes.split(','));
      if (!cancelled) setNoted(map);
    })();
    return () => { cancelled = true; };
  }, [sel?.doc, codes, sel?.direction, lookupNoted]);

  if (!sel) return null;
  const q = historyQuery.trim().toUpperCase();
  const boxes = sel.parcels.reduce((a, p) => a + p.boxes, 0);
  const ddts = (sel.ddts || []).length ? sel.ddts : (sel.ddtSummaries || []);
  const signed = sel.signed !== undefined ? sel.signed : !!sel.signatureDataUrl;

  return (
    <div className="flex flex-col gap-3 px-3.5 pb-[22px] pt-3.5">
      <div className="rounded-2xl border border-[rgba(148,163,184,.25)] bg-white p-[13px]">
        <div className="flex items-center gap-2">
          <div className="rounded-full px-2 py-[3px] text-[10px] font-extrabold uppercase tracking-[.1em] text-white" style={{ background: sel.direction === 'out' ? '#FF7A00' : '#1F6FEB' }}>
            {sel.direction === 'out' ? 'Outbound' : 'Inbound'}
          </div>
          <div className="ml-auto text-[10px] font-bold" style={{ color: signed ? '#16A34A' : '#DC2626' }}>{signed ? 'signed' : 'unsigned'}</div>
        </div>
        <div className="mt-2.5 font-mono text-base font-bold">{sel.doc}</div>
        <div className="text-xs text-secondary">{sel.date}</div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[rgba(148,163,184,.25)] bg-white">
        <Row label="Carrier" value={sel.carrier} />
        <Row label="Driver" value={sel.driverName || '—'} />
        <Row label="Operator" value={sel.operator} />
        <Row label="Parcels / boxes" value={`${sel.parcels.length} parcels / ${boxes} boxes`} last />
      </div>

      <div className="overflow-hidden rounded-2xl border border-[rgba(148,163,184,.25)] bg-white">
        <div className="border-b border-[rgba(148,163,184,.25)] bg-page px-3 py-2.5 text-[10px] font-bold uppercase tracking-[.08em] text-secondary">Parcels</div>
        {sel.parcels.map((p, i) => (
          <div
            key={p.code}
            className="flex items-center gap-2.5 border-b border-[rgba(148,163,184,.15)] px-3 py-2.5 last:border-b-0"
            style={{ background: q && p.code.includes(q) ? 'rgba(31,111,235,.07)' : '#fff' }}
          >
            <div className="w-[18px] flex-none font-mono text-[10px] text-light">{i + 1}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[11.5px] font-bold">{p.code}</div>
              <div className="truncate text-[10.5px]" style={{ color: p.noCode || p.damage ? '#DC2626' : '#64748B' }}>
                {p.noCode ? 'NO VALID CODE' + (p.noCodeNote ? ` — ${p.noCodeNote}` : '') : p.damage || 'Good, sealed'}
              </div>
              {/* Answered for every box, not only the ones that went wrong: a
                  green line naming the note is also how the operator confirms
                  the box did travel, without opening the PDF. */}
              {sel.direction === 'out' && noted && (
                noted.has(p.code) ? (
                  <div className="truncate text-[10.5px] font-bold" style={{ color: '#15803D' }}>
                    on {noted.get(p.code).doc || 'a delivery note'}
                    {noted.get(p.code).createdAtIso && !sameDay(noted.get(p.code).createdAtIso, sel.closedAtIso)
                      ? ` · issued ${shortDate(noted.get(p.code).createdAtIso)}`
                      : ''}
                  </div>
                ) : (
                  <div className="truncate text-[10.5px] font-bold" style={{ color: '#C2410C' }}>
                    on no delivery note
                  </div>
                )
              )}
            </div>
            {p.photoDataUrl && (
              <button onClick={() => openPhoto(p.photoDataUrl)} className="flex-none">
                <img src={p.photoDataUrl} alt="Damage attachment" className="h-10 w-10 rounded-md border border-[rgba(220,38,38,.35)] object-cover" />
              </button>
            )}
            <div className="flex-none text-[11px] text-light">{p.time}</div>
            <div className="flex-none text-[11px] font-bold">{p.boxes}×</div>
          </div>
        ))}
      </div>

      {/* The delivery notes issued for this handover. A DDT travels with the
          goods and is the document anyone asking afterwards wants to see, so
          it has to outlive the confirmation screen it was printed from.
          `ddts` are the full notes this device issued; `ddtSummaries` are what
          the database reports for a session closed on another phone — enough to
          say which notes exist, and reprintable by fetching the stored PDF. */}
      {/* A session that issued nothing of its own still owes an explanation. */}
      {sel.direction === 'out' && ddts.length === 0 && noted && (
        <div className="rounded-2xl border border-[rgba(148,163,184,.35)] bg-white px-[13px] py-3">
          <div className="text-[12px] font-bold text-ink">No delivery note was issued here</div>
          <div className="mt-1 text-[11px] leading-[1.5] text-secondary">
            {(sel.parcels || []).every((p) => noted.has(p.code))
              ? 'Every parcel in this session already travelled on an earlier note, so no second one was issued — a parcel ships once.'
              : 'The Prep-Center could not place these parcels, and no shipping reference was given for them.'}
          </div>
        </div>
      )}

      {ddts.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-[rgba(148,163,184,.25)] bg-white">
          <div className="border-b border-[rgba(148,163,184,.25)] bg-page px-3 py-2.5 text-[10px] font-bold uppercase tracking-[.08em] text-secondary">
            Delivery notes ({ddts.length})
          </div>
          {ddts.map((d) => (
            <button
              key={d.number}
              onClick={() => printDdt(d)}
              className="flex w-full items-center gap-2.5 border-b border-[rgba(148,163,184,.15)] px-3 py-3 text-left last:border-b-0"
            >
              <Printer size={16} strokeWidth={2} className="flex-none text-primary" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[12px] font-bold text-ink">{d.number}</div>
                <div className="truncate text-[11px] text-secondary">
                  {d.fbaId || d.shipmentId} · {ddtBoxes(d)} box{ddtBoxes(d) === 1 ? '' : 'es'}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <button onClick={() => printDocument(sel)} className="flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-xl bg-primary text-[15px] font-extrabold text-white">
          <Download size={18} strokeWidth={2} /> Download PDF
        </button>
        <button onClick={() => printDocument(sel)} className="flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-xl border border-[rgba(148,163,184,.4)] bg-white text-sm font-bold text-ink">
          <Printer size={17} strokeWidth={2} /> Reprint document
        </button>
      </div>
    </div>
  );
}

// Dates only matter here when the note is from another day — an earlier
// shipment is the whole point of the line.
function sameDay(a, b) {
  if (!a || !b) return true;
  return new Date(a).toDateString() === new Date(b).toDateString();
}
function shortDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

// A note issued here carries its parcels; one summarised by the database
// carries a box count instead. Both have to render the same line.
function ddtBoxes(d) {
  if (Array.isArray(d.parcels)) return d.parcels.reduce((a, p) => a + (p.boxes || 1), 0);
  return d.boxes || 0;
}

function Row({ label, value, last }) {
  return (
    <div className={'flex justify-between px-[13px] py-2.5' + (last ? '' : ' border-b border-[rgba(148,163,184,.15)]')}>
      <span className="text-xs text-secondary">{label}</span>
      <span className="text-xs font-bold">{value}</span>
    </div>
  );
}
