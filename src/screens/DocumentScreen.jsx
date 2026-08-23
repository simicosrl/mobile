import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import { Download } from '../components/icons';

function Seg({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className={'flex-1 rounded-lg py-2.5 text-xs font-bold ' + (active ? 'bg-white text-ink shadow-seg' : 'bg-transparent text-secondary')}
    >
      {children}
    </button>
  );
}

export default function DocumentScreen() {
  const { history, printDocument } = useApp();
  const [filter, setFilter] = useState('all');

  const rows = useMemo(
    () => history.filter((h) => filter === 'all' || h.direction === filter),
    [history, filter],
  );

  return (
    <div className="flex flex-col gap-2.5 px-3.5 pb-5 pt-3">
      <div className="text-xs leading-normal text-secondary">
        Every inbound and outbound handover document. Tap Download to generate the PDF and open the share sheet
        (print, save, or send it by email from there).
      </div>
      <div className="flex gap-1.5 rounded-[11px] bg-segtrack p-1">
        <Seg active={filter === 'all'} onClick={() => setFilter('all')}>All</Seg>
        <Seg active={filter === 'in'} onClick={() => setFilter('in')}>Inbound</Seg>
        <Seg active={filter === 'out'} onClick={() => setFilter('out')}>Outbound</Seg>
      </div>

      {rows.length === 0 && (
        <div className="rounded-[13px] border border-[rgba(148,163,184,.25)] bg-white p-[22px_14px] text-center">
          <div className="text-[13px] font-bold">No documents yet</div>
          <div className="mt-1 text-[11.5px] text-secondary">Close and sign a session to generate a handover document.</div>
        </div>
      )}

      {rows.map((h) => {
        const boxes = h.parcels.reduce((a, p) => a + p.boxes, 0);
        return (
          <div key={h.doc} className="flex items-center gap-2.5 rounded-[13px] border border-[rgba(148,163,184,.25)] bg-white p-[12px_13px]">
            <div
              className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] text-[10px] font-extrabold tracking-[.06em]"
              style={{ background: h.direction === 'in' ? 'rgba(31,111,235,.1)' : 'rgba(255,122,0,.12)', color: h.direction === 'in' ? '#1F6FEB' : '#C2410C' }}
            >
              {h.direction === 'in' ? 'IN' : 'OUT'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs font-bold">{h.doc}</div>
              <div className="truncate text-[11px] text-secondary">{h.carrier} · {h.driverName || '—'} · {h.date}</div>
              <div className="text-[10.5px] text-light">{h.parcels.length} parcels / {boxes} boxes</div>
            </div>
            <button
              onClick={() => printDocument(h)}
              aria-label={`Download ${h.doc}`}
              className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-primary text-white"
            >
              <Download size={17} strokeWidth={2.2} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
