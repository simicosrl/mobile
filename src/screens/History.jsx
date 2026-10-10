import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import { Search, Download, TriangleAlert } from '../components/icons';

// The Inbound and Outbound tabs: the courier handovers of one direction from
// the last 7 days (what the app keeps on screen), newest first. Each row
// downloads its PDF directly; tapping it opens the handover. Outbound rows
// also say how many delivery notes (DDT) went with them.

function Seg({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className={'flex-1 rounded-lg py-2 text-xs font-bold ' + (active ? 'bg-white text-ink shadow-seg' : 'bg-transparent text-secondary')}
    >
      {children}
    </button>
  );
}

const ddtsOf = (h) => ((h.ddts || []).length ? h.ddts : (h.ddtSummaries || []));
const isToday = (h) => {
  const t = h.closedAtIso ? new Date(h.closedAtIso) : null;
  return t && !Number.isNaN(t.getTime()) && t.toDateString() === new Date().toDateString();
};

export default function History({ direction }) {
  const { history, historyQuery, setHistoryQuery, openSession, printDocument } = useApp();
  const isOut = direction === 'out';
  const [period, setPeriod] = useState('7d');
  const [carrier, setCarrier] = useState('all');

  const mine = useMemo(() => history.filter((h) => h.direction === direction), [history, direction]);
  const carriers = useMemo(() => [...new Set(mine.map((h) => h.carrier).filter(Boolean))].sort(), [mine]);

  const q = historyQuery.trim().toUpperCase();
  let matchedCode = null;
  const rows = mine
    .filter((h) => period === '7d' || isToday(h))
    .filter((h) => carrier === 'all' || h.carrier === carrier)
    .map((h) => {
      if (!q) return h;
      const hit = h.parcels.find((p) => String(p.code || '').toUpperCase().includes(q));
      if (hit) { matchedCode = matchedCode || hit.code; return { ...h, hit: hit.code }; }
      if (String(h.doc).toUpperCase().includes(q) || String(h.carrier || '').toUpperCase().includes(q) || String(h.driverName || '').toUpperCase().includes(q)) return h;
      if (isOut && ddtsOf(h).some((d) => String(d.number || '').toUpperCase().includes(q) || String(d.fbaId || '').toUpperCase().includes(q))) return h;
      return null;
    })
    .filter(Boolean);

  return (
    <div className="flex flex-col gap-2.5 px-3.5 pb-5 pt-3">
      <input
        value={historyQuery}
        onChange={(e) => setHistoryQuery(e.target.value)}
        placeholder={isOut ? 'Search tracking, document, driver or DDT' : 'Search tracking, document or driver'}
        className="min-h-[48px] w-full rounded-xl border border-inputborder bg-page px-4 text-[13px] text-ink"
      />
      <div className="flex gap-2">
        <div className="flex flex-1 gap-1 rounded-[11px] bg-segtrack p-1">
          <Seg active={period === 'today'} onClick={() => setPeriod('today')}>Today</Seg>
          <Seg active={period === '7d'} onClick={() => setPeriod('7d')}>Last 7 days</Seg>
        </div>
        <select
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
          aria-label="Carrier"
          className="min-h-[40px] max-w-[42%] rounded-[11px] border border-inputborder bg-white px-2.5 text-[12px] font-bold text-ink"
        >
          <option value="all">All carriers</option>
          {carriers.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {q && matchedCode && rows.length > 0 && (
        <div className="flex items-center gap-1.5 rounded-[11px] border border-[rgba(31,111,235,.25)] bg-[rgba(31,111,235,.07)] px-2.5 py-2">
          <Search size={15} strokeWidth={2.2} className="flex-none text-primary" />
          <div className="text-[11.5px] font-bold text-primary">
            {matchedCode} — found in {rows.length} handover{rows.length > 1 ? 's' : ''}
          </div>
        </div>
      )}

      {rows.map((h) => {
        const boxes = h.parcels.reduce((a, p) => a + p.boxes, 0);
        const signed = h.signed !== undefined ? h.signed : !!h.signatureDataUrl;
        const ddtCount = ddtsOf(h).length;
        const missingDdt = isOut && (h.ddtExcluded || []).length > 0;
        return (
          <div key={h.doc} className="flex items-center gap-2 rounded-[13px] border border-[rgba(148,163,184,.25)] bg-white p-[11px_12px]">
            <button onClick={() => openSession(h.doc)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <div className="truncate font-mono text-xs font-bold">{h.doc}</div>
                  {isOut && ddtCount > 0 && (
                    <span className="flex-none rounded-full bg-[rgba(255,122,0,.12)] px-1.5 py-[1px] text-[9.5px] font-extrabold text-accent-dark">{ddtCount} DDT</span>
                  )}
                  {missingDdt && <TriangleAlert size={13} strokeWidth={2.2} className="flex-none text-danger" />}
                </div>
                <div className="truncate text-[11px] text-secondary">{h.carrier} · {h.driverName || '—'} · {h.date}</div>
                {h.hit && <div className="truncate font-mono text-[10.5px] font-bold text-primary">{h.hit}</div>}
              </div>
              <div className="flex-none text-right">
                <div className="text-xs font-extrabold">{h.parcels.length} / {boxes}</div>
                <div className="text-[10px] font-bold" style={{ color: signed ? '#16A34A' : '#DC2626' }}>{signed ? 'signed' : 'unsigned'}</div>
              </div>
            </button>
            <button
              onClick={() => printDocument(h)}
              aria-label={`Download ${h.doc}`}
              className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-primary text-white"
            >
              <Download size={16} strokeWidth={2.2} />
            </button>
          </div>
        );
      })}

      {rows.length === 0 && (
        <div className="rounded-[13px] border border-[rgba(148,163,184,.25)] bg-white p-[22px_14px] text-center">
          <div className="text-[13px] font-bold">{q ? 'No match' : isOut ? 'No outbound handovers' : 'No inbound handovers'}</div>
          <div className="mt-1 text-[11.5px] text-secondary">
            {q
              ? `No ${isOut ? 'outbound' : 'inbound'} handover matches that.`
              : `${period === 'today' ? 'Nothing today' : 'Nothing in the last 7 days'}${carrier !== 'all' ? ` for ${carrier}` : ''}.`}
          </div>
        </div>
      )}
    </div>
  );
}
