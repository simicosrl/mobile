import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import { Search } from '../components/icons';
import { CARRIERS } from '../lib/carriers';

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

export default function History() {
  const { history, historyQuery, setHistoryQuery, historyFilter, setHistoryFilter, openSession } = useApp();
  const [carrierFilter, setCarrierFilter] = useState('All carriers');

  const carrierOptions = useMemo(() => ['All carriers', ...CARRIERS.filter((c) => history.some((h) => h.carrier === c))], [history]);
  const cycleCarrier = () => {
    const idx = carrierOptions.indexOf(carrierFilter);
    setCarrierFilter(carrierOptions[(idx + 1) % carrierOptions.length]);
  };

  const q = historyQuery.trim().toUpperCase();
  let matchedCode = null;
  const filtered = history
    .filter((h) => historyFilter === 'all' || h.direction === historyFilter)
    .filter((h) => carrierFilter === 'All carriers' || h.carrier === carrierFilter)
    .map((h) => {
      if (!q) return h;
      const hit = h.parcels.find((p) => p.code.includes(q));
      if (hit) { matchedCode = matchedCode || hit.code; return { ...h, hit: hit.code }; }
      if (h.doc.includes(q) || h.carrier.toUpperCase().includes(q) || h.driverName.toUpperCase().includes(q)) return h;
      return null;
    })
    .filter(Boolean);

  const hasMatch = !!(q && filtered.length && matchedCode);
  const noResults = q && filtered.length === 0;

  return (
    <div className="flex flex-col gap-2.5 px-3.5 pb-5 pt-3">
      <input
        value={historyQuery}
        onChange={(e) => setHistoryQuery(e.target.value)}
        placeholder="Search tracking ID or document"
        className="min-h-[48px] w-full rounded-xl border border-inputborder bg-page px-4 text-[13px] text-ink"
      />
      <div className="flex gap-1.5 rounded-[11px] bg-segtrack p-1">
        <Seg active={historyFilter === 'all'} onClick={() => setHistoryFilter('all')}>All</Seg>
        <Seg active={historyFilter === 'in'} onClick={() => setHistoryFilter('in')}>Inbound</Seg>
        <Seg active={historyFilter === 'out'} onClick={() => setHistoryFilter('out')}>Outbound</Seg>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Chip>Last 7 days</Chip>
        <button onClick={cycleCarrier}>
          <Chip>{carrierFilter}</Chip>
        </button>
        <Chip>Operator: me</Chip>
      </div>

      {hasMatch && (
        <div className="flex items-center gap-1.5 rounded-[11px] border border-[rgba(31,111,235,.25)] bg-[rgba(31,111,235,.07)] px-2.5 py-2">
          <Search size={15} strokeWidth={2.2} className="flex-none text-primary" />
          <div className="text-[11.5px] font-bold text-primary">
            {matchedCode} — found in {filtered.length} session{filtered.length > 1 ? 's' : ''}
          </div>
        </div>
      )}

      {filtered.map((h) => {
        const boxes = h.parcels.reduce((a, p) => a + p.boxes, 0);
        const signed = h.signed !== undefined ? h.signed : !!h.signatureDataUrl;
        return (
          <button
            key={h.doc}
            onClick={() => openSession(h.doc)}
            className="flex min-h-[62px] items-center gap-2.5 rounded-[13px] border border-[rgba(148,163,184,.25)] bg-white p-[12px_13px] text-left"
          >
            <div
              className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] text-[10px] font-extrabold tracking-[.06em]"
              style={{ background: h.direction === 'in' ? 'rgba(31,111,235,.1)' : 'rgba(255,122,0,.12)', color: h.direction === 'in' ? '#1F6FEB' : '#C2410C' }}
            >
              {h.direction === 'in' ? 'IN' : 'OUT'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs font-bold">{h.doc}</div>
              <div className="truncate text-[11px] text-secondary">{h.carrier} · {h.driverName || '—'} · {h.date}</div>
              {h.hit && <div className="truncate font-mono text-[10.5px] font-bold text-primary">{h.hit}</div>}
            </div>
            <div className="flex-none text-right">
              <div className="text-xs font-extrabold">{h.parcels.length} / {boxes}</div>
              <div className="text-[10px] font-bold" style={{ color: signed ? '#16A34A' : '#DC2626' }}>{signed ? 'signed' : 'unsigned'}</div>
            </div>
          </button>
        );
      })}

      {noResults && (
        <div className="rounded-[13px] border border-[rgba(148,163,184,.25)] bg-white p-[22px_14px] text-center">
          <div className="text-[13px] font-bold">No match</div>
          <div className="mt-1 text-[11.5px] text-secondary">No session contains that tracking ID or document number.</div>
        </div>
      )}
    </div>
  );
}

function Chip({ children }) {
  return (
    <div className="rounded-full border border-[rgba(148,163,184,.35)] px-2.5 py-1.5 text-[11px] font-semibold text-secondary">{children}</div>
  );
}
