import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import { Printer, TriangleAlert } from '../components/icons';

// The DDT tab: every delivery note issued for the outbound handovers of the
// last 7 days, newest first — the document that travels with the goods, which
// before only showed inside each handover. A note issued on this phone carries
// its full data; one pulled from the shared history is a summary (number, FBA
// ID, boxes) whose PDF is fetched when printed. Both print the same way.

function ddtTime(d, h) {
  const t = Date.parse(d.createdAtIso || h.closedAtIso || '');
  return Number.isNaN(t) ? 0 : t;
}
function ddtBoxes(d) {
  if (Array.isArray(d.parcels)) return d.parcels.reduce((a, p) => a + (p.boxes || 1), 0);
  return d.boxes || 0;
}
function shortDay(t) {
  if (!t) return '';
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function DdtList() {
  const { history, printDdt, openSession } = useApp();
  const [query, setQuery] = useState('');

  const all = useMemo(() => history
    .filter((h) => h.direction === 'out')
    .flatMap((h) => ((h.ddts || []).length ? h.ddts : (h.ddtSummaries || [])).map((d) => ({ d, h, t: ddtTime(d, h) })))
    .sort((a, b) => b.t - a.t), [history]);

  const q = query.trim().toUpperCase();
  const rows = q
    ? all.filter(({ d, h }) =>
      [d.number, d.fbaId, d.shipmentId, h.doc, ...(d.destination || []), ...(d.customer || [])]
        .some((v) => String(v || '').toUpperCase().includes(q))
      || (d.parcels || h.parcels || []).some((p) => String(p.code || '').toUpperCase().includes(q)))
    : all;

  return (
    <div className="flex flex-col gap-2.5 px-3.5 pb-5 pt-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search DDT number, FBA ID or tracking"
        className="min-h-[48px] w-full rounded-xl border border-inputborder bg-page px-4 text-[13px] text-ink"
      />
      <div className="text-[11px] text-secondary">Delivery notes of the last 7 days · {all.length} in total</div>

      {rows.map(({ d, h, t }) => {
        const boxes = ddtBoxes(d);
        const to = (d.destination || [])[0];
        const client = (d.customer || [])[0];
        const provisional = d.numberReserved === false;
        return (
          <div key={`${h.doc}-${d.number}`} className="rounded-[13px] border border-[rgba(148,163,184,.25)] bg-white p-[11px_12px]">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <div className="truncate font-mono text-[12.5px] font-extrabold text-ink">{d.number}</div>
                  {provisional && (
                    <span className="flex flex-none items-center gap-0.5 rounded-full bg-danger-tint px-1.5 py-[1px] text-[9.5px] font-extrabold text-danger-dark">
                      <TriangleAlert size={10} strokeWidth={2.4} /> provisional no.
                    </span>
                  )}
                </div>
                <div className="truncate text-[11px] text-secondary">
                  {[shortDay(t) || d.date, `${boxes} box${boxes === 1 ? '' : 'es'}`, d.fbaId || d.shipmentId].filter(Boolean).join(' · ')}
                </div>
                {(to || client) && (
                  <div className="truncate text-[11px] text-ink">
                    {to ? `To ${to}` : ''}{to && client ? ' · ' : ''}{client ? `for ${client}` : ''}
                  </div>
                )}
              </div>
              <button
                onClick={() => printDdt(d)}
                aria-label={`Print ${d.number}`}
                className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-accent text-white"
              >
                <Printer size={16} strokeWidth={2.2} />
              </button>
            </div>
            <button onClick={() => openSession(h.doc, 'ddts')} className="mt-1.5 font-mono text-[10.5px] font-bold text-primary underline underline-offset-2">
              {h.doc}
            </button>
          </div>
        );
      })}

      {rows.length === 0 && (
        <div className="rounded-[13px] border border-[rgba(148,163,184,.25)] bg-white p-[22px_14px] text-center">
          <div className="text-[13px] font-bold">{q ? 'No match' : 'No delivery notes'}</div>
          <div className="mt-1 text-[11.5px] text-secondary">
            {q ? 'No DDT matches that.' : 'DDTs are issued when an outbound handover is signed.'}
          </div>
        </div>
      )}
    </div>
  );
}
