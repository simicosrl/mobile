import { useApp } from '../state/AppContext';
import { Download, Printer } from '../components/icons';

export default function SessionDetail() {
  const { history, selectedDocNo, historyQuery, printDocument } = useApp();
  const sel = history.find((h) => h.doc === selectedDocNo);
  if (!sel) return null;
  const q = historyQuery.trim().toUpperCase();
  const boxes = sel.parcels.reduce((a, p) => a + p.boxes, 0);
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
              <div className="truncate text-[10.5px]" style={{ color: p.damage ? '#DC2626' : '#64748B' }}>{p.damage || 'Good, sealed'}</div>
            </div>
            <div className="flex-none text-[11px] text-light">{p.time}</div>
            <div className="flex-none text-[11px] font-bold">{p.boxes}×</div>
          </div>
        ))}
      </div>

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

function Row({ label, value, last }) {
  return (
    <div className={'flex justify-between px-[13px] py-2.5' + (last ? '' : ' border-b border-[rgba(148,163,184,.15)]')}>
      <span className="text-xs text-secondary">{label}</span>
      <span className="text-xs font-bold">{value}</span>
    </div>
  );
}
